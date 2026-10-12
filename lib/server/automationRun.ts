import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  clampGuards,
  clockFrom,
  decide,
  renderTemplate,
  MAX_PER_RUN_ALL,
  type AutomationAction,
  type AutomationClock,
  type AutomationConditions,
  type AutomationDecision,
  type AutomationGuards,
  type AutomationSubject,
  type AutomationTrigger,
} from "@/lib/automations";
import { automationSmsText } from "@/lib/messages";
import { asOrgId } from "@/lib/org";
import {
  isPipelineStage,
  OPEN_STAGES,
  type PipelineStage,
} from "@/lib/pipeline";
import { canSendTo, type Textable } from "@/lib/smsConsent";
import { adminDb } from "@/lib/server/admin";
import {
  appendNote,
  optOutsByPhone,
  phoneSuppressionKey,
} from "@/lib/server/customerNotes";
import { sendSmsToPhone } from "@/lib/server/customerSms";
import { notifyCrew } from "@/lib/server/notify";
import {
  PROPERTY_TYPES,
  type PropertyType,
  type ServiceType,
} from "@/lib/types";

/**
 * Running the automations the owner built.
 *
 * The decision of whether to act lives in `lib/automations.ts`, which is pure
 * and testable. This file is the part that cannot be pure: it reads the
 * records a trigger needs, claims a send so two overlapping runs cannot double
 * one up, and performs the action.
 *
 * Three things are deliberately shaped the way `lib/leadNurture.ts` shaped
 * them, after the bugs that taught them:
 *
 * The person is the phone number, not the record. The Meta lead webhook
 * creates a fresh customer document per form submission, so one handset sits
 * in the database several times. A per-record send counter therefore counts
 * nothing: three records on one number each think they have sent none. So the
 * ledger below is keyed on the number.
 *
 * The claim happens before the send, in a transaction, and is not released on
 * failure. A message sent twice cannot be recalled; one sent late can still be
 * sent.
 *
 * Consent is checked against the number too, from one scan rather than one per
 * recipient — `optOutForPhone` walks the whole customers collection on every
 * call, and forty of those inside a sixty-second function is a timeout rather
 * than a slower right answer.
 */

/**
 * The per-number, per-automation send ledger.
 *
 * Server-only and absent from firestore.rules, which is what makes it
 * server-only: rules deny by default, so a collection with no `match` block
 * cannot be read or written by any client, while the Admin SDK bypasses rules
 * entirely. `apiKeys` is kept the same way.
 */
const TOUCHES = "automationTouches";

/** Spacing between sends, so a batch does not arrive at Twilio as one burst. */
const SEND_INTERVAL_MS = 1100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function touchId(
  orgId: string,
  automationId: string,
  phoneKey: string,
): string {
  return `${orgId}__${automationId}__${phoneKey}`;
}

function millis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The parts of a customer every trigger needs, read once for the whole run. */
interface CustomerRow {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  phoneKey: string | null;
  address: string;
  propertyType: PropertyType | null;
  stage: PipelineStage | null;
  serviceTypes: ServiceType[];
  /** Raw, for canSendTo. */
  /** Exactly the fields canSendTo reads, straight off the document. */
  consent: Textable;
  lastContactedAtMs: number | null;
  pipelineChangedAtMs: number | null;
  updatedAtMs: number | null;
  createdAtMs: number | null;
  lifetimeValue: number | null;
  pipelineValue: number | null;
  /** When they last texted us, from the notes timeline. */
  lastInboundAtMs: number | null;
}

function readCustomer(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): CustomerRow {
  const data = doc.data();
  const phone = str(data.phone);

  // The newest inbound note, which is how "have they replied" is answered.
  // `hasInboundNote` in lib/leadNurture.ts asks the same question of the same
  // field; this one needs the date as well, to compare against the anchor.
  let lastInboundAtMs: number | null = null;
  if (Array.isArray(data.notes)) {
    for (const note of data.notes) {
      if (typeof note !== "object" || note === null) continue;
      const entry = note as Record<string, unknown>;
      if (entry.kind !== "sms_in") continue;
      const at = millis(entry.createdAt);
      if (at !== null && (lastInboundAtMs === null || at > lastInboundAtMs)) {
        lastInboundAtMs = at;
      }
    }
  }

  return {
    id: doc.id,
    firstName: str(data.firstName),
    lastName: str(data.lastName),
    phone,
    phoneKey: phoneSuppressionKey(phone),
    address: str(data.address),
    propertyType: PROPERTY_TYPES.includes(data.propertyType as PropertyType)
      ? (data.propertyType as PropertyType)
      : null,
    stage: isPipelineStage(data.pipelineStage) ? data.pipelineStage : null,
    serviceTypes: Array.isArray(data.serviceTypes)
      ? (data.serviceTypes.filter(
          (item) => typeof item === "string",
        ) as ServiceType[])
      : [],
    consent: {
      phone,
      smsConsent: data.smsConsent,
      smsOptOut: data.smsOptOut,
    } as Textable,
    lastContactedAtMs: millis(data.lastContactedAt),
    pipelineChangedAtMs: millis(data.pipelineChangedAt),
    updatedAtMs: millis(data.updatedAt),
    createdAtMs: millis(data.createdAt),
    lifetimeValue: num(data.lifetimeValue),
    pipelineValue: num(data.pipelineValue),
    lastInboundAtMs,
  };
}

async function loadCustomers(orgId: string): Promise<Map<string, CustomerRow>> {
  const snap = await adminDb().collection("customers").get();
  const rows = new Map<string, CustomerRow>();
  for (const doc of snap.docs) {
    if (asOrgId(doc.get("orgId")) !== orgId) continue;
    rows.set(doc.id, readCustomer(doc));
  }
  return rows;
}

/** What an automation would do to one customer, and whether it will. */
export interface AutomationCandidate {
  customerId: string;
  customerName: string;
  phone: string;
  subject: AutomationSubject;
  /** The exact text that would be sent, opt-out line included. Empty if none. */
  message: string;
  decision: AutomationDecision;
}

/** Enough of an automation to evaluate. The stored document satisfies this. */
export interface RunnableAutomation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationConditions;
  action: AutomationAction;
  guards: AutomationGuards;
}

function fullName(row: CustomerRow): string {
  const name = `${row.firstName} ${row.lastName}`.trim();
  return name === "" ? "A customer" : name;
}

/**
 * The records a trigger measures from, as subjects the engine can judge.
 *
 * Each case answers the same three questions: which records are in scope, what
 * date the wait is measured from, and what money is on it. Anything whose
 * customer has been deleted is dropped rather than carried as a nameless row —
 * an automation cannot text a record that is not there, and listing it in the
 * preview would be noise.
 *
 * Queried on one equality filter and filtered in memory after. That is on
 * purpose: equality-only queries need no composite index, so adding a trigger
 * here never needs a firestore.indexes.json change or a deploy that fails
 * halfway with a missing-index error.
 */
async function subjectsFor(
  orgId: string,
  trigger: AutomationTrigger,
  customers: Map<string, CustomerRow>,
  touches: Map<string, { touches: number; lastTouchAtMs: number | null }>,
  automationId: string,
): Promise<AutomationSubject[]> {
  const db = adminDb();
  const subjects: AutomationSubject[] = [];

  const push = (
    row: CustomerRow,
    anchorMs: number | null,
    amount: number | null,
    serviceType: ServiceType | null,
  ) => {
    const ledger = row.phoneKey
      ? touches.get(touchId(orgId, automationId, row.phoneKey))
      : undefined;
    subjects.push({
      customerId: row.id,
      firstName: row.firstName || null,
      phone: row.phone || null,
      address: row.address || null,
      propertyType: row.propertyType,
      stage: row.stage,
      serviceType,
      anchorAt: isoOrNull(anchorMs),
      amount,
      touches: ledger?.touches ?? 0,
      lastTouchAt: isoOrNull(ledger?.lastTouchAtMs ?? null),
      repliedSince:
        row.lastInboundAtMs !== null &&
        anchorMs !== null &&
        row.lastInboundAtMs > anchorMs,
    });
  };

  if (trigger === "estimate_unanswered" || trigger === "invoice_overdue") {
    const kind = trigger === "estimate_unanswered" ? "estimate" : "invoice";
    const snap = await db
      .collection("documents")
      .where("kind", "==", kind)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (asOrgId(data.orgId) !== orgId) continue;
      const row = customers.get(str(data.customerId));
      if (!row) continue;

      if (trigger === "estimate_unanswered") {
        // Only an estimate still waiting on an answer. An acceptance, a
        // decline or a conversion to an invoice all end it, and the status
        // field is not always the record of the last of those — which is why
        // convertedToId is read rather than trusted to it.
        if (str(data.status) !== "sent") continue;
        if (data.acceptance || data.decline) continue;
        if (str(data.convertedToId)) continue;
        const anchor =
          millis(data.sentAt) ??
          millis(data.issuedAt) ??
          millis(data.createdAt);
        push(
          row,
          anchor,
          num(data.total),
          str(data.serviceType) as ServiceType | null,
        );
      } else {
        const status = str(data.status);
        if (status !== "sent" && status !== "partial") continue;
        const balance = num(data.balanceDue);
        if (balance === null || balance <= 0) continue;
        // No due date means nothing to be overdue against. `decide` refuses a
        // null anchor with a reason, so it is pushed rather than dropped: the
        // preview saying "nothing to measure from" is more use than silence.
        push(
          row,
          millis(data.dueAt),
          balance,
          str(data.serviceType) as ServiceType | null,
        );
      }
    }
    return subjects;
  }

  if (trigger === "job_finished") {
    const snap = await db
      .collection("jobs")
      .where("status", "==", "complete")
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (asOrgId(data.orgId) !== orgId) continue;
      const row = customers.get(str(data.customerId));
      if (!row) continue;
      const anchor =
        millis(data.completedAt) ??
        millis(data.finishedAt) ??
        millis(data.scheduledEnd);
      push(
        row,
        anchor,
        num(data.price),
        str(data.serviceType) as ServiceType | null,
      );
    }
    return subjects;
  }

  // The two customer-only triggers. No second collection to read.
  for (const row of customers.values()) {
    if (trigger === "lead_idle") {
      // A lead still in play. A closed one is not idle, it is finished, and
      // "still thinking about that quote?" to somebody who already said no is
      // the message that gets a number reported.
      if (!row.stage || !OPEN_STAGES.includes(row.stage)) continue;
      const anchor =
        row.lastContactedAtMs ??
        row.pipelineChangedAtMs ??
        row.updatedAtMs ??
        row.createdAtMs;
      push(row, anchor, row.pipelineValue, row.serviceTypes[0] ?? null);
    } else {
      const anchor =
        row.lastContactedAtMs ?? row.updatedAtMs ?? row.createdAtMs;
      push(row, anchor, row.lifetimeValue, row.serviceTypes[0] ?? null);
    }
  }
  return subjects;
}

async function loadTouches(
  orgId: string,
  automationId: string,
): Promise<Map<string, { touches: number; lastTouchAtMs: number | null }>> {
  const snap = await adminDb()
    .collection(TOUCHES)
    .where("automationId", "==", automationId)
    .get();
  const out = new Map<
    string,
    { touches: number; lastTouchAtMs: number | null }
  >();
  for (const doc of snap.docs) {
    if (str(doc.get("orgId")) !== orgId) continue;
    out.set(doc.id, {
      touches: num(doc.get("touches")) ?? 0,
      lastTouchAtMs: millis(doc.get("lastTouchAt")),
    });
  }
  return out;
}

function moneyLabel(amount: number | null): string {
  return amount === null ? "" : `$${Math.round(amount)}`;
}

/**
 * Everything an automation would do right now, without doing any of it.
 *
 * This is what the builder's preview shows, and it is the single most
 * important safety feature in the whole feature: the owner sees the names, the
 * count and the exact wording before anything is armed. A sequence nobody has
 * read is the thing that goes wrong, and the only reliable way to make
 * somebody read it is to show it to him.
 *
 * Deliberately the same code path the run uses. A preview computed by a second
 * implementation would eventually disagree with the real one, and the
 * disagreement would be discovered by a customer.
 */
export async function evaluateAutomation(
  orgId: string,
  automation: RunnableAutomation,
  now: Date = new Date(),
): Promise<{ clock: AutomationClock; candidates: AutomationCandidate[] }> {
  const clock = clockFrom(now);
  const [customers, touches, stopped] = await Promise.all([
    loadCustomers(orgId),
    loadTouches(orgId, automation.id),
    optOutsByPhone(orgId),
  ]);

  const subjects = await subjectsFor(
    orgId,
    automation.trigger,
    customers,
    touches,
    automation.id,
  );

  // One send per handset per run, whichever record came up first. Two records
  // for one person coming due the same night is the normal case here, not an
  // edge one.
  const seenNumbers = new Set<string>();
  const candidates: AutomationCandidate[] = [];

  for (const subject of subjects) {
    const row = customers.get(subject.customerId);
    if (!row) continue;

    let decision = decide(automation, subject, clock);

    // Consent and opt-out are checked after the engine, not inside it: the
    // engine is pure and knows nothing about the customers collection, and
    // these two answers come from the number rather than the record.
    if (decision.send && automation.action.kind === "send_sms") {
      const key = row.phoneKey;
      const optOut = key ? stopped.get(key) : null;
      if (optOut) {
        decision = {
          send: false,
          reason: `This number replied ${optOut.keyword || "STOP"} — not texting it`,
        };
      } else {
        const verdict = canSendTo(row.consent);
        if (!verdict.allowed) {
          decision = { send: false, reason: verdict.reason };
        } else if (key && seenNumbers.has(key)) {
          decision = {
            send: false,
            reason: "Already going out on this number in this run",
          };
        } else if (key) {
          seenNumbers.add(key);
        }
      }
    }

    const vars = {
      first_name: row.firstName,
      business: "Grime Busters",
      amount: moneyLabel(subject.amount),
      owner_phone: "502-599-6855",
    };
    // Rendered for every action, not just the text. A note reading
    // "Hi {first_name}" on a customer's own timeline is the same mistake as a
    // text reading it, and it was only the text that filled them in at first.
    const message =
      automation.action.kind === "send_sms"
        ? automationSmsText(automation.action.body, vars)
        : renderTemplate(automation.action.body, vars);

    candidates.push({
      customerId: row.id,
      customerName: fullName(row),
      phone: row.phone,
      subject,
      message,
      decision,
    });
  }

  return { clock, candidates };
}

/**
 * Claims one send, so two overlapping runs cannot both make it.
 *
 * The ledger document is the claim. Incrementing inside a transaction that
 * first re-reads it means the second run sees the first run's count and its
 * own `decide` has already been passed a stale one — so the count is checked
 * again here, against the number the transaction read.
 *
 * Not released if the send then fails. That is the same trade
 * `lib/leadNurture.ts` makes and for the same reason: a failure delays the
 * retry by the minimum gap rather than by a day, and a message sent twice
 * cannot be recalled.
 */
async function claimTouch(
  orgId: string,
  automationId: string,
  phoneKey: string,
  maxTouches: number,
  minGapDays: number,
  nowMs: number,
): Promise<{ claimed: boolean; reason: string }> {
  const ref = adminDb()
    .collection(TOUCHES)
    .doc(touchId(orgId, automationId, phoneKey));
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (num(snap.get("touches")) ?? 0) : 0;
    const lastMs = snap.exists ? millis(snap.get("lastTouchAt")) : null;

    if (current >= maxTouches) {
      return {
        claimed: false,
        reason: "Already had every message this automation sends",
      };
    }
    if (lastMs !== null && nowMs - lastMs < minGapDays * 86_400_000) {
      return { claimed: false, reason: "Texted too recently on this number" };
    }

    tx.set(
      ref,
      {
        orgId,
        automationId,
        phoneKey,
        touches: current + 1,
        lastTouchAt: Timestamp.fromMillis(nowMs),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { claimed: true, reason: "" };
  });
}

/**
 * The shared limits for one cron tick: how many sends are left, and how long.
 *
 * The send count is what bounds a bad morning. The clock is what stops the run
 * being cut off mid-send by the platform: this route also runs the quote
 * follow-up sequence, both of them pace sends about a second apart to stay
 * inside Twilio's rate limit, and `maxDuration` is sixty seconds for the lot.
 * Twenty-five sends is twenty-eight seconds of deliberate waiting before any
 * of the reads are counted.
 *
 * A timeout would not double-send — the claim is written before the send and
 * is not released — but it would abandon the remaining automations silently
 * and report nothing. Stopping on our own clock means the run ends with a
 * count of what it held back, which the screen can show.
 */
export interface RunBudget {
  remaining: number;
  /** Epoch millis after which no new send is started. */
  deadlineMs: number;
}

export interface AutomationRunResult {
  automationId: string;
  name: string;
  sent: number;
  failed: number;
  /** Matched and allowed, but left for the next run by a cap. */
  held: number;
  considered: number;
}

/**
 * Runs one automation, up to its own cap and the run-wide budget.
 *
 * `budget` is shared across every automation in the run and is what actually
 * bounds a bad morning: six automations each capped at twenty-five would
 * otherwise be a hundred and fifty texts from one cron tick, which is the
 * thing the per-automation cap was supposed to prevent.
 */
export async function runAutomation(
  orgId: string,
  automation: RunnableAutomation,
  budget: RunBudget,
  now: Date = new Date(),
): Promise<AutomationRunResult> {
  const guards = clampGuards(automation.guards);
  const { candidates } = await evaluateAutomation(orgId, automation, now);
  const sendable = candidates.filter((candidate) => candidate.decision.send);

  const result: AutomationRunResult = {
    automationId: automation.id,
    name: automation.name,
    sent: 0,
    failed: 0,
    held: 0,
    considered: candidates.length,
  };

  const nowMs = now.getTime();
  let madeThisAutomation = 0;

  for (const candidate of sendable) {
    if (
      madeThisAutomation >= guards.maxPerRun ||
      budget.remaining <= 0 ||
      Date.now() >= budget.deadlineMs
    ) {
      result.held += 1;
      continue;
    }

    const phoneKey = phoneSuppressionKey(candidate.phone);

    // A text cannot be sent without a number to send it to.
    if (automation.action.kind === "send_sms" && !phoneKey) {
      result.failed += 1;
      continue;
    }

    // Every action is claimed, not just the text. Claiming only texts was a
    // real bug and not a small one: `decide` reads its repeat rules from this
    // ledger, so an action that never wrote to it stayed at zero touches for
    // ever and fired again on every run — a once-only "add a note" would have
    // written the same line onto a customer's timeline every morning for up to
    // the whole length of its window.
    //
    // Keyed on the phone number where there is one, so duplicate records for
    // one handset do not each get their own note, and on the record id where
    // there is not.
    const claim = await claimTouch(
      orgId,
      automation.id,
      phoneKey ?? candidate.customerId,
      guards.maxTouches,
      guards.minGapDays,
      nowMs,
    );
    if (!claim.claimed) {
      result.held += 1;
      continue;
    }

    try {
      await performAction(orgId, automation, candidate);
      result.sent += 1;
      madeThisAutomation += 1;
      budget.remaining -= 1;
    } catch {
      result.failed += 1;
    }

    if (automation.action.kind === "send_sms") await wait(SEND_INTERVAL_MS);
  }

  return result;
}

async function performAction(
  orgId: string,
  automation: RunnableAutomation,
  candidate: AutomationCandidate,
): Promise<void> {
  const author = { uid: "automation", name: `Automation: ${automation.name}` };

  switch (automation.action.kind) {
    case "send_sms": {
      if (candidate.message === "") throw new Error("empty message");
      const result = await sendSmsToPhone(
        candidate.phone,
        candidate.message,
        orgId,
      );
      if (!result.ok) throw new Error(result.error);
      await appendNote(
        candidate.customerId,
        {
          text: candidate.message,
          kind: "sms_out",
          authorUid: author.uid,
          authorName: author.name,
        },
        { markContacted: true },
      );
      return;
    }
    case "add_note": {
      // `markContacted: false` is load-bearing. appendNote treats anything but
      // an explicit false as "we spoke to this person", and a note the app
      // wrote to itself is not that. Leaving it defaulted stamped
      // lastContactedAt, which made the pipeline's "untouched for a week" flag
      // untrue and reset the idle clock every other automation measures from —
      // so an automation that added a note silently stopped every automation
      // that waits for a quiet lead, including itself on its next step.
      await appendNote(
        candidate.customerId,
        {
          text: candidate.message,
          kind: "note",
          authorUid: author.uid,
          authorName: author.name,
        },
        { markContacted: false },
      );
      return;
    }
    case "move_stage": {
      const stage = automation.action.stage;
      if (!stage) throw new Error("no stage to move to");
      await adminDb().collection("customers").doc(candidate.customerId).update({
        pipelineStage: stage,
        pipelineChangedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: author.uid,
        updatedByName: author.name,
      });
      // Not a contact either: moving a card is bookkeeping, not a conversation.
      await appendNote(
        candidate.customerId,
        {
          text: `Moved by "${automation.name}".`,
          kind: "stage_change",
          authorUid: author.uid,
          authorName: author.name,
        },
        { markContacted: false },
      );
      return;
    }
    case "notify_crew": {
      await notifyCrew({
        type: "automation_ran",
        actorName: automation.name,
        customerId: candidate.customerId,
        body: `${candidate.customerName}: ${candidate.message || automation.name}`,
      });
      return;
    }
  }
}

/**
 * The run-wide budget, shared by every automation in one tick.
 *
 * `startedAt` is the moment the request began rather than the moment this is
 * called, because the quote follow-up sequence has usually already spent part
 * of the function's time by then — measuring from here would hand the
 * automations a full window that is not there.
 */
export function newBudget(startedAt: number = Date.now()): RunBudget {
  return { remaining: MAX_PER_RUN_ALL, deadlineMs: startedAt + RUN_WINDOW_MS };
}

/**
 * How long into the request new sends may still be started.
 *
 * Forty-five of the sixty `maxDuration` allows, leaving fifteen for the send
 * in flight, the note written beside it and the run receipt.
 */
const RUN_WINDOW_MS = 45_000;
