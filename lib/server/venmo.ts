import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { statusAfterPayment, sumPayments, type Payment } from "@/lib/documents";
import { DEFAULT_ORG_ID } from "@/lib/org";
import { adminDb } from "@/lib/server/admin";
import { parseVenmoEmail, type VenmoPayment } from "@/lib/venmoEmail";
import { matchVenmoPayment, type OpenBill } from "@/lib/venmoMatch";
import { checkVenmoSignature, type SignatureCheck } from "@/lib/venmoSignature";

/**
 * Venmo payments, read from Venmo's own "paid you" emails.
 *
 * The owner's iCloud forwards every email from venmo.com to a private
 * address on a subdomain Resend receives for (VENMO_INBOUND_ADDRESS). Resend
 * calls app/api/inbound/venmo, which hands the email id here. From there:
 *
 *   1. Fetch the email from Resend, including the raw message.
 *   2. Check Venmo's DKIM signature on the raw message. This is the whole
 *      security model: anyone who learns the inbound address can email it,
 *      but nobody but Venmo can sign as venmo.com. An email that fails is
 *      kept for the record and never applied to a bill.
 *   3. Read who paid, how much, and the note — from the headers the
 *      signature covers, not from anything an attacker could have added.
 *   4. Match it to one unpaid bill (lib/venmoMatch.ts). Certain → mark paid.
 *      Anything else → the "Venmo payments to match" list on Money.
 *
 * Every step is idempotent on the Resend email id: a webhook retried, or the
 * same email forwarded twice, is recorded once and applied once.
 */

const TIMEOUT_MS = 10_000;
export const VENMO_COLLECTION = "venmoPayments";

export interface VenmoConfig {
  apiKey: string;
  webhookSecret: string;
  /** The private address the iCloud rule forwards to. */
  inboundAddress: string;
}

export function venmoConfig(): VenmoConfig {
  return {
    apiKey: process.env.RESEND_API_KEY ?? "",
    webhookSecret: process.env.RESEND_INBOUND_SECRET ?? "",
    inboundAddress: (process.env.VENMO_INBOUND_ADDRESS ?? "").trim().toLowerCase(),
  };
}

interface ReceivedEmail {
  id: string;
  to: string[];
  received_for?: string[];
  subject: string;
  text: string | null;
  html: string | null;
  created_at: string;
  raw?: { download_url: string } | null;
}

async function resendGet(path: string, apiKey: string): Promise<Response> {
  return fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Strip tags for a body that only came as HTML. Good enough to find a note. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|h\d|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#36;|&dollar;/g, "$")
    .replace(/&[a-z]+;/g, " ");
}

/** Every unpaid bill: open invoices, and finished jobs no invoice covers. */
export async function loadOpenBills(): Promise<OpenBill[]> {
  const db = adminDb();
  const [customers, invoices, jobs] = await Promise.all([
    db.collection("customers").get(),
    db.collection("documents").where("kind", "==", "invoice").get(),
    db.collection("jobs").where("status", "==", "complete").get(),
  ]);
  const nameOf = new Map(
    customers.docs.map((d) => [d.id, `${d.get("firstName") ?? ""} ${d.get("lastName") ?? ""}`.trim()]),
  );

  const bills: OpenBill[] = [];
  const invoicedJobs = new Set<string>();
  for (const doc of invoices.docs) {
    const data = doc.data();
    if (typeof data.jobId === "string" && data.jobId) invoicedJobs.add(data.jobId);
    if (!["sent", "partial"].includes(String(data.status))) continue;
    const owed = typeof data.balanceDue === "number" ? data.balanceDue : 0;
    if (owed <= 0) continue;
    bills.push({
      kind: "invoice",
      id: doc.id,
      customerId: String(data.customerId ?? ""),
      customerName: nameOf.get(String(data.customerId ?? "")) ?? String(data.customerName ?? ""),
      owed,
      number: String(data.number ?? ""),
      at: data.createdAt?.toMillis?.() ?? 0,
    });
  }
  for (const doc of jobs.docs) {
    const data = doc.data();
    if (data.paidAt || invoicedJobs.has(doc.id)) continue;
    const owed = typeof data.price === "number" ? data.price : 0;
    if (owed <= 0) continue;
    bills.push({
      kind: "job",
      id: doc.id,
      customerId: String(data.customerId ?? ""),
      customerName: nameOf.get(String(data.customerId ?? "")) ?? "",
      owed,
      at: (data.completedAt ?? data.scheduledStart)?.toMillis?.() ?? 0,
    });
  }
  return bills;
}

type StoredPayment = Omit<Payment, "receivedAt"> & { receivedAt: Timestamp };

/**
 * Marks one bill paid by this Venmo payment, inside a transaction that first
 * re-reads the bill. A bill somebody marked paid by hand a minute ago is left
 * alone, and the payment goes to the to-match list instead of paying twice.
 */
export async function applyVenmoPayment(
  emailId: string,
  payment: VenmoPayment,
  bill: Pick<OpenBill, "kind" | "id">,
  receivedAt: Timestamp,
  by: { uid: string; name: string },
): Promise<{ applied: boolean; problem: string }> {
  const db = adminDb();
  const billRef = db.collection(bill.kind === "invoice" ? "documents" : "jobs").doc(bill.id);
  const recordRef = db.collection(VENMO_COLLECTION).doc(emailId);

  return db.runTransaction(async (tx) => {
    const [billSnap, recordSnap] = await Promise.all([tx.get(billRef), tx.get(recordRef)]);
    if (recordSnap.exists && recordSnap.get("status") === "applied") {
      return { applied: false, problem: "This Venmo payment is already applied." };
    }
    if (!billSnap.exists) return { applied: false, problem: "That bill no longer exists." };
    const data = billSnap.data() ?? {};
    const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: by.uid, updatedByName: by.name };

    if (bill.kind === "job") {
      if (data.paidAt) return { applied: false, problem: "That job is already marked paid." };
      tx.update(billRef, { paidAt: receivedAt, paidBy: by.uid, paymentCollected: true, ...stamp });
    } else {
      const existing: StoredPayment[] = Array.isArray(data.payments) ? data.payments : [];
      if (existing.some((p) => p?.providerRef === emailId)) {
        return { applied: false, problem: "This Venmo payment is already on that invoice." };
      }
      if (!["sent", "partial"].includes(String(data.status))) {
        return { applied: false, problem: "That invoice is not open." };
      }
      const entry: StoredPayment = {
        id: `venmo-${emailId}`,
        amount: payment.amount,
        receivedAt,
        method: `Venmo · ${payment.payerName}`.slice(0, 80),
        recordedBy: by.uid,
        recordedByName: by.name,
        provider: "venmo",
        providerRef: emailId,
      };
      const payments = [...existing, entry];
      const amountPaid = sumPayments(payments);
      const total = typeof data.total === "number" ? data.total : 0;
      const status = statusAfterPayment(
        (data.status ?? "sent") as Parameters<typeof statusAfterPayment>[0],
        total,
        amountPaid,
      );
      tx.update(billRef, {
        payments,
        amountPaid,
        balanceDue: Math.max(0, Number((total - amountPaid).toFixed(2))),
        status,
        ...(status === "paid" ? { settledAt: FieldValue.serverTimestamp() } : {}),
        ...stamp,
      });
    }

    tx.set(
      recordRef,
      {
        status: "applied",
        matchedKind: bill.kind,
        matchedId: bill.id,
        customerId: data.customerId ?? null,
        appliedBy: by.uid,
        appliedByName: by.name,
        appliedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { applied: true, problem: "" };
  });
}

export interface IngestResult {
  outcome: "applied" | "needs_match" | "unverified" | "ignored" | "duplicate";
  detail: string;
  payment?: VenmoPayment;
  customerId?: string | null;
}

/** The webhook's whole job, given the id Resend sent. */
export async function ingestVenmoEmail(emailId: string, config: VenmoConfig): Promise<IngestResult> {
  const db = adminDb();
  const recordRef = db.collection(VENMO_COLLECTION).doc(emailId);
  if ((await recordRef.get()).exists) return { outcome: "duplicate", detail: "Already recorded." };

  const response = await resendGet(`/emails/receiving/${encodeURIComponent(emailId)}`, config.apiKey);
  if (!response.ok) throw new Error(`Resend returned HTTP ${response.status} for email ${emailId}`);
  const email = (await response.json()) as ReceivedEmail;

  // Only mail addressed to the private Venmo address. Anything else Resend
  // receives on the subdomain is none of this route's business.
  const recipients = [...(email.to ?? []), ...(email.received_for ?? [])].map((a) =>
    String(a).toLowerCase().replace(/^.*</, "").replace(/>.*$/, "").trim(),
  );
  if (!config.inboundAddress || !recipients.includes(config.inboundAddress)) {
    return { outcome: "ignored", detail: "Not addressed to the Venmo inbound address." };
  }

  let check: SignatureCheck = { verified: false, problem: "No raw message from Resend", signedSubject: "" };
  if (email.raw?.download_url) {
    const raw = await fetch(email.raw.download_url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (raw.ok) check = await checkVenmoSignature(Buffer.from(await raw.arrayBuffer()));
    else check = { verified: false, problem: `Raw download returned HTTP ${raw.status}`, signedSubject: "" };
  }

  const text = email.text ?? (email.html ? htmlToText(email.html) : "");
  // Verified: read the signed subject. Unverified: read what arrived, purely
  // so the record says what it claimed; it is never applied.
  const payment = parseVenmoEmail({ subject: check.verified ? check.signedSubject : email.subject, text });
  if (!payment) {
    // A request, a "you paid", a newsletter: Venmo emails that are not money
    // coming in. Recorded as ignored so a retry is still a no-op.
    await recordRef.create({ orgId: DEFAULT_ORG_ID, status: "ignored", subject: email.subject ?? "", createdAt: FieldValue.serverTimestamp() });
    return { outcome: "ignored", detail: "Not a Venmo payment received." };
  }

  const receivedAt = Number.isFinite(Date.parse(email.created_at))
    ? Timestamp.fromMillis(Date.parse(email.created_at))
    : Timestamp.now();
  const bills = await loadOpenBills();
  const match = matchVenmoPayment(payment, bills);

  await recordRef.create({
    orgId: DEFAULT_ORG_ID,
    payerName: payment.payerName,
    amount: payment.amount,
    note: payment.note,
    subject: email.subject ?? "",
    receivedAt,
    verified: check.verified,
    verifyProblem: check.problem,
    status: check.verified ? "needs_match" : "unverified",
    matchReason: match.reason,
    suggestions: match.suggestions.map((b) => ({ kind: b.kind, id: b.id, customerName: b.customerName, owed: b.owed, number: b.number ?? null })),
    createdAt: FieldValue.serverTimestamp(),
  });

  if (!check.verified) {
    return { outcome: "unverified", detail: check.problem, payment };
  }
  if (!match.bill) {
    return { outcome: "needs_match", detail: match.reason, payment };
  }

  const applied = await applyVenmoPayment(emailId, payment, match.bill, receivedAt, { uid: "venmo", name: "Venmo" });
  if (!applied.applied) {
    await recordRef.update({ matchReason: `${match.reason}, but ${applied.problem.toLowerCase()}` });
    return { outcome: "needs_match", detail: applied.problem, payment };
  }
  return { outcome: "applied", detail: match.reason, payment, customerId: match.bill.customerId };
}
