import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { agentAuthor, type Scope } from "@/lib/apiKeys";
import { computeTotals, type LineItem } from "@/lib/documents";
import { grossFor, outstanding } from "@/lib/money/summary";
import { adminDb } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/auth";
import { appendNote, getCustomer } from "@/lib/server/customerNotes";
import { isTwilioConfigured, sendSms } from "@/lib/server/twilio";
import type { AuthorisedKey } from "@/lib/server/apiKeyAuth";
import { findTool } from "./tools";

/**
 * What the tools actually do.
 *
 * Two rules hold throughout, and they are the reason this file is separate from
 * the route:
 *
 *   Every write is stamped with the agent, never with a person. See
 *   `agentAuthor`. Without it, an agent's mistake is indistinguishable from
 *   Nicolas's three weeks later.
 *
 *   Every failure is a sentence the agent can act on. "Customer not found —
 *   call find_customer first" gets the next call right; "400" gets the same
 *   call retried.
 */

type Args = Record<string, unknown>;

/** A Firestore document as a plain bag of fields, with its id. */
type Row = Record<string, unknown> & { id: string };

const rowOf = (doc: {
  id: string;
  data: () => Record<string, unknown> | undefined;
}): Row => ({ ...(doc.data() ?? {}), id: doc.id });

const str = (args: Args, name: string): string =>
  typeof args[name] === "string" ? (args[name] as string).trim() : "";
const numberOf = (args: Args, name: string): number | null => {
  const value = args[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

function required(args: Args, name: string): string {
  const value = str(args, name);
  if (!value) throw new ApiError(400, `"${name}" is required.`);
  return value;
}

async function customerOr404(customerId: string) {
  const customer = await getCustomer(customerId);
  if (!customer) {
    throw new ApiError(
      404,
      `No customer with id "${customerId}". Use find_customer to get a valid id first.`,
    );
  }
  return customer;
}

/* ---------------------------------------------------------------- reading */

async function findCustomerTool(args: Args) {
  const query = required(args, "query").toLowerCase();
  const limit = Math.min(Math.max(numberOf(args, "limit") ?? 10, 1), 50);

  // Read and filter in memory rather than with a Firestore query: this book is
  // hundreds of rows, and substring matching across three fields is not
  // something Firestore indexes anyway.
  const snap = await adminDb().collection("customers").get();
  const digits = query.replace(/\D/g, "");
  const matches = snap.docs
    .map(rowOf)
    .filter((row) => {
      const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.toLowerCase();
      const address = String(row.address ?? "").toLowerCase();
      const phone = String(row.phone ?? "").replace(/\D/g, "");
      return (
        name.includes(query) ||
        address.includes(query) ||
        (digits.length >= 4 && phone.includes(digits))
      );
    })
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || "(no name)",
      phone: row.phone ?? "",
      address: row.address ?? "",
      status: row.status ?? "lead",
      pipelineStage: row.pipelineStage ?? null,
      lifetimeValue: row.lifetimeValue ?? 0,
    }));

  return { found: matches.length, customers: matches };
}

async function listJobsTool(args: Args) {
  const from = str(args, "from") ? new Date(str(args, "from")) : new Date();
  if (Number.isNaN(from.getTime())) throw new ApiError(400, '"from" must be YYYY-MM-DD.');
  const to = str(args, "to")
    ? new Date(str(args, "to"))
    : new Date(from.getTime() + 7 * 86_400_000);
  if (Number.isNaN(to.getTime())) throw new ApiError(400, '"to" must be YYYY-MM-DD.');
  const status = str(args, "status");

  const snap = await adminDb()
    .collection("jobs")
    .where("scheduledStart", ">=", Timestamp.fromDate(from))
    .where("scheduledStart", "<=", Timestamp.fromDate(to))
    .get();

  const jobs = snap.docs
    .map(rowOf)
    .filter((job) => !status || job.status === status)
    .map((job) => ({
      id: job.id,
      customerId: job.customerId,
      serviceType: job.serviceType,
      status: job.status,
      price: job.price,
      start: (job.scheduledStart as Timestamp | undefined)?.toDate().toISOString() ?? null,
      end: (job.scheduledEnd as Timestamp | undefined)?.toDate().toISOString() ?? null,
      assignedTo: job.assignedTo ?? [],
      paid: job.paidAt != null,
    }));

  return { from: from.toISOString(), to: to.toISOString(), count: jobs.length, jobs };
}

async function moneySummaryTool(args: Args) {
  const year = numberOf(args, "year") ?? new Date().getFullYear();

  const [jobsSnap, docsSnap] = await Promise.all([
    adminDb().collection("jobs").get(),
    adminDb().collection("documents").get(),
  ]);

  const jobs = jobsSnap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      price: typeof data.price === "number" ? data.price : 0,
      paidAt: (data.paidAt as Timestamp | null) ?? null,
    };
  });

  const documents = docsSnap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      kind: String(data.kind ?? ""),
      jobId: typeof data.jobId === "string" ? data.jobId : null,
      payments: Array.isArray(data.payments)
        ? (data.payments as Record<string, unknown>[]).map((payment) => ({
            amount: typeof payment.amount === "number" ? payment.amount : 0,
            receivedAt: (payment.receivedAt as Timestamp | null) ?? null,
          }))
        : [],
      lineItems: Array.isArray(data.lineItems) ? (data.lineItems as LineItem[]) : [],
      discount: typeof data.discount === "number" ? data.discount : 0,
      taxRatePct: typeof data.taxRatePct === "number" ? data.taxRatePct : 0,
    };
  });

  const gross = grossFor(year, jobs, documents);

  // Recomputed from the lines rather than read from the stored total, for the
  // same reason the printed document does it: a figure that disagrees with the
  // lines it came from is the one a customer spots.
  const totals = new Map(
    documents.map((doc) => [
      doc.id,
      computeTotals(doc.lineItems, doc.discount, doc.taxRatePct).total,
    ]),
  );

  return {
    year,
    received: gross,
    stillOwed: outstanding(documents, totals),
    note: "Counts money when it arrived, not when the work was done. A job that was also invoiced is counted once, through the invoice.",
  };
}

async function listLeadsTool(args: Args) {
  const stage = str(args, "stage");
  const limit = Math.min(Math.max(numberOf(args, "limit") ?? 25, 1), 100);

  const snap = await adminDb().collection("customers").get();
  const now = Date.now();
  const leads = snap.docs
    .map(rowOf)
    .filter((row) => row.status === "lead" || row.status === "quoted")
    .filter((row) => !stage || row.pipelineStage === stage)
    .map((row) => {
      const changed = (row.pipelineChangedAt as Timestamp | undefined)?.toMillis() ?? now;
      return {
        id: row.id,
        name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || "(no name)",
        phone: row.phone ?? "",
        address: row.address ?? "",
        stage: row.pipelineStage ?? "new_lead",
        value: row.pipelineValue ?? 0,
        source: row.source ?? "door_knock",
        daysSitting: Math.max(0, Math.floor((now - changed) / 86_400_000)),
      };
    })
    .sort((a, b) => b.daysSitting - a.daysSitting)
    .slice(0, limit);

  return { count: leads.length, leads };
}

/* ---------------------------------------------------------------- writing */

async function createLeadTool(args: Args, key: AuthorisedKey) {
  const author = agentAuthor(key);
  const firstName = str(args, "firstName");
  const lastName = str(args, "lastName");
  const phone = str(args, "phone");
  const address = str(args, "address");

  if (!firstName && !lastName && !phone && !address) {
    throw new ApiError(400, "Give at least a name, a phone number or an address.");
  }

  const now = Timestamp.now();
  const note = str(args, "note");
  const ref = await adminDb()
    .collection("customers")
    .add({
      firstName,
      lastName,
      phone,
      email: str(args, "email"),
      address,
      // No pin. The map geocodes the address on its own, the same as a lead
      // typed in by hand.
      lat: 0,
      lng: 0,
      status: "lead",
      notes: note
        ? [
            {
              id: `agent-${Date.now()}`,
              text: note,
              kind: "note",
              authorUid: author.uid,
              authorName: author.displayName,
              createdAt: now,
            },
          ]
        : [],
      tags: [],
      serviceTypes: [],
      createdAt: now,
      createdBy: author.uid,
      createdByName: author.displayName,
      lastContactedAt: now,
      lastContactedBy: author.uid,
      lastContactedByName: author.displayName,
      lifetimeValue: 0,
      pipelineStage: "new_lead",
      pipelineChangedAt: now,
      pipelineValue: 0,
      source: "manual",
      sourceLeadId: null,
      updatedAt: now,
      updatedBy: author.uid,
      updatedByName: author.displayName,
    });

  return { customerId: ref.id, created: true };
}

async function addNoteTool(args: Args, key: AuthorisedKey) {
  const customerId = required(args, "customerId");
  const text = required(args, "text");
  await customerOr404(customerId);
  const author = agentAuthor(key);

  await appendNote(
    customerId,
    { text, kind: "note", authorUid: author.uid, authorName: author.displayName },
    { markContacted: false },
  );
  return { added: true, customerId };
}

async function draftEstimateTool(args: Args, key: AuthorisedKey) {
  const customerId = required(args, "customerId");
  const customer = await customerOr404(customerId);
  const author = agentAuthor(key);

  const rawLines = Array.isArray(args.lines) ? (args.lines as Args[]) : [];
  if (rawLines.length === 0) throw new ApiError(400, "An estimate needs at least one line.");

  const lineItems: LineItem[] = rawLines.map((line, index) => ({
    id: `agent-${index}`,
    name: str(line, "name"),
    description: str(line, "description"),
    quantity: 1,
    unitPrice: numberOf(line, "unitPrice") ?? 0,
    taxable: true,
    discountPct: Math.min(100, Math.max(0, numberOf(line, "discountPct") ?? 0)),
  }));

  const serviceType = str(args, "serviceType") || "pressure_washing";
  const totals = computeTotals(lineItems, 0, 6);
  const now = Timestamp.now();

  const ref = await adminDb()
    .collection("documents")
    .add({
      kind: "estimate",
      // Drafts carry no number: numbering is what makes a document part of the
      // financial record, and a draft an agent made is not that until a person
      // has looked at it.
      number: "",
      status: "draft",
      customerId,
      customerName: `${customer.firstName} ${customer.lastName}`.trim(),
      serviceType,
      lineItems,
      payments: [],
      discount: 0,
      taxRatePct: 6,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      total: totals.total,
      amountPaid: 0,
      notes: "",
      issuedAt: now,
      dueAt: null,
      sentAt: null,
      createdAt: now,
      createdBy: author.uid,
      createdByName: author.displayName,
      updatedAt: now,
      updatedBy: author.uid,
      updatedByName: author.displayName,
    });

  return {
    documentId: ref.id,
    total: totals.total,
    status: "draft",
    sent: false,
    note: "Saved as a draft. A person has to review and send it.",
  };
}

/* ----------------------------------------------------------------- sending */

async function sendSmsTool(args: Args, key: AuthorisedKey) {
  const customerId = required(args, "customerId");
  const body = required(args, "body");
  const customer = await customerOr404(customerId);
  const author = agentAuthor(key);

  if (!isTwilioConfigured) {
    throw new ApiError(503, "Texting is not configured on this deployment.");
  }
  if (!customer.phone) {
    throw new ApiError(400, `${customer.firstName || "That customer"} has no phone number.`);
  }
  if (body.length > 1600) throw new ApiError(400, "That message is too long.");

  const result = await sendSms(customer.phone, body);
  if (!result.ok) {
    await appendNote(
      customerId,
      {
        text: `Agent text failed: ${result.error}\n\n${body}`,
        kind: "sms_out",
        authorUid: author.uid,
        authorName: author.displayName,
      },
      { markContacted: false },
    );
    throw new ApiError(502, result.error ?? "Twilio refused the message.");
  }

  await appendNote(customerId, {
    text: body,
    kind: "sms_out",
    authorUid: author.uid,
    authorName: author.displayName,
  });

  return { sent: true, customerId, note: "Logged on the customer's timeline as sent by the agent." };
}

async function scheduleJobTool(args: Args, key: AuthorisedKey) {
  const customerId = required(args, "customerId");
  const customer = await customerOr404(customerId);
  const author = agentAuthor(key);

  const start = new Date(required(args, "start"));
  const end = new Date(required(args, "end"));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(400, "start and end must be ISO 8601 timestamps.");
  }
  if (end <= start) throw new ApiError(400, "The end time has to be after the start.");

  const price = numberOf(args, "price");
  if (price === null || price < 0) throw new ApiError(400, "Give a price of zero or more.");

  const serviceType = str(args, "serviceType") || "pressure_washing";
  const assignedTo = Array.isArray(args.assignedTo)
    ? (args.assignedTo as unknown[]).filter((uid): uid is string => typeof uid === "string")
    : [];

  const now = Timestamp.now();
  const ref = await adminDb()
    .collection("jobs")
    .add({
      customerId,
      serviceType,
      scheduledStart: Timestamp.fromDate(start),
      scheduledEnd: Timestamp.fromDate(end),
      status: "scheduled",
      price,
      assignedTo,
      beforePhotos: [],
      afterPhotos: [],
      jobNotes: "Booked by the Ops Agent.",
      enRouteAt: null,
      enRouteBy: null,
      startedAt: null,
      startedBy: null,
      finishedAt: null,
      finishedBy: null,
      paymentCollected: null,
      completedAt: null,
      completedBy: null,
      paidAt: null,
      paidBy: null,
      createdAt: now,
      createdBy: author.uid,
      createdByName: author.displayName,
      updatedAt: now,
      updatedBy: author.uid,
      updatedByName: author.displayName,
    });

  // The confirmation text is why this tool needs the send scope. Best effort:
  // the job is already booked, and a Twilio outage must not make a real
  // calendar entry look like it failed.
  let texted = false;
  let textProblem: string | null = null;
  if (isTwilioConfigured && customer.phone) {
    const when = start.toLocaleString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const result = await sendSms(
      customer.phone,
      `Grime Busters: your ${serviceType.replace(/_/g, " ")} is scheduled for ${when}. Reply here if you need to change it.`,
    );
    texted = result.ok;
    textProblem = result.ok ? null : (result.error ?? "Twilio refused the message.");
    if (result.ok) {
      await appendNote(customerId, {
        text: `Booked for ${when}. Confirmation sent.`,
        kind: "job",
        authorUid: author.uid,
        authorName: author.displayName,
      });
    }
  } else {
    textProblem = "Texting is not configured, so no confirmation was sent.";
  }

  return { jobId: ref.id, booked: true, customerTexted: texted, textProblem };
}

/* ------------------------------------------------------------ the dispatch */

type Handler = (args: Args, key: AuthorisedKey) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  find_customer: (args) => findCustomerTool(args),
  list_jobs: (args) => listJobsTool(args),
  money_summary: (args) => moneySummaryTool(args),
  list_leads: (args) => listLeadsTool(args),
  create_lead: createLeadTool,
  add_note: addNoteTool,
  draft_estimate: draftEstimateTool,
  send_sms: sendSmsTool,
  schedule_job: scheduleJobTool,
};

/** The scope a tool needs, or null when there is no such tool. */
export function scopeForTool(name: string): Scope | null {
  return findTool(name)?.scope ?? null;
}

export async function runTool(
  name: string,
  args: Args,
  key: AuthorisedKey,
): Promise<unknown> {
  const handler = HANDLERS[name];
  if (!handler) {
    throw new ApiError(404, `No tool called "${name}". Call tools/list to see what is available.`);
  }
  return handler(args, key);
}

/**
 * Every tool in the catalogue has an implementation, and vice versa.
 *
 * Exported so a test can assert it rather than somebody discovering a tool that
 * lists fine and 404s when called.
 */
export const IMPLEMENTED_TOOLS: readonly string[] = Object.keys(HANDLERS);
