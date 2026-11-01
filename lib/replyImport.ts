/**
 * Filing the replies that arrived before the inbound webhook was connected.
 *
 * Until November 2026 the business number's messaging service was set to
 * "defer to sender's webhook" and the number had no webhook, so every text a
 * customer sent back was accepted by Twilio, kept in its message log, and
 * never reached the CRM. Nobody saw a reply; nothing said one had arrived.
 *
 * Twilio still has them. This decides what to do with each one, given the
 * customers on file and what is already on their timelines. Pure and
 * import-free so every rule is tested by calling it; the route does the
 * reading and writing.
 *
 * Safe to run more than once. Every reply becomes a note whose id is derived
 * from Twilio's message SID, and the live webhook uses the same id, so a
 * reply already on a timeline — imported earlier, or delivered live — is
 * recognised and skipped rather than filed twice.
 */

/** One inbound message as read from Twilio's log. */
export interface LoggedReply {
  sid: string;
  from: string;
  body: string;
  /** When Twilio received it, in milliseconds. */
  sentAt: number;
}

/** What the plan needs to know about a customer. */
export interface ImportCustomer {
  id: string;
  phone: string;
  /** Ids of the notes already on the timeline. */
  noteIds: ReadonlySet<string>;
}

export interface PlannedNote {
  id: string;
  sid: string;
  body: string;
  sentAt: number;
}

export interface ReplyImportPlan {
  /** Replies to add to each customer's timeline, oldest first. */
  byCustomer: Map<string, PlannedNote[]>;
  /** Replies from numbers that match no customer, oldest first. */
  unmatched: LoggedReply[];
  /** Replies already on a timeline. */
  alreadyFiled: number;
  /** Blank, or not a message at all. */
  skipped: number;
}

/**
 * The note id a reply is filed under.
 *
 * Shared with the live webhook on purpose: it is what lets an import that
 * runs after the webhook is connected skip what the webhook already filed.
 */
export function replyNoteId(sid: string): string {
  return `twilio-${sid.trim()}`;
}

/** The last ten digits, the form every phone comparison in the app uses. */
function phoneKey(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? digits : "";
}

export function planReplyImport(
  replies: readonly LoggedReply[],
  customers: readonly ImportCustomer[],
): ReplyImportPlan {
  // The first customer on file for a number wins, the same rule the webhook
  // follows (it takes the first match of its scan), so an imported reply and
  // a live one from the same handset land on the same record.
  const byPhone = new Map<string, ImportCustomer>();
  for (const customer of customers) {
    const key = phoneKey(customer.phone);
    if (key && !byPhone.has(key)) byPhone.set(key, customer);
  }

  const plan: ReplyImportPlan = {
    byCustomer: new Map(),
    unmatched: [],
    alreadyFiled: 0,
    skipped: 0,
  };
  const seen = new Set<string>();

  const ordered = [...replies].sort((a, b) => a.sentAt - b.sentAt);
  for (const reply of ordered) {
    const sid = reply.sid?.trim() ?? "";
    const body = reply.body?.trim() ?? "";
    if (!sid || !body || !Number.isFinite(reply.sentAt)) {
      plan.skipped += 1;
      continue;
    }
    // Twilio's list can repeat a message across pages if one arrives mid-read.
    if (seen.has(sid)) continue;
    seen.add(sid);

    const customer = byPhone.get(phoneKey(reply.from));
    if (!customer) {
      plan.unmatched.push({ ...reply, sid, body });
      continue;
    }

    const id = replyNoteId(sid);
    if (customer.noteIds.has(id)) {
      plan.alreadyFiled += 1;
      continue;
    }

    const list = plan.byCustomer.get(customer.id) ?? [];
    list.push({ id, sid, body, sentAt: reply.sentAt });
    plan.byCustomer.set(customer.id, list);
  }

  return plan;
}

/** How many replies the plan files onto timelines. */
export function plannedCount(plan: ReplyImportPlan): number {
  let total = 0;
  for (const notes of plan.byCustomer.values()) total += notes.length;
  return total;
}
