/**
 * Who a group text should actually go to.
 *
 * Three questions, and the third is the one that was missing: who cannot be
 * texted at all, who has the crew taken out by hand, and who has already had
 * this exact message. That last one matters because a blast gets run twice —
 * the first attempt half failed, or it was sent to one filter on Monday and a
 * wider one on Friday — and the people in the overlap do not want it again.
 * Sending somebody the same promotion twice is how a number gets reported.
 *
 * Pure and import-free, so every rule here can be tested by running it. This
 * decides who receives a text, which is the same reason lib/leadNurture.ts is
 * written the same way: a bug in it reaches a real person's phone.
 *
 * Whether somebody may be texted at all is NOT decided here. That question
 * belongs to lib/smsConsent.ts' `canSendTo`, which is what /api/sms/blast asks
 * before each message, and it is passed in rather than reimplemented. Asking a
 * second copy of the question is how the screen came to show a person who
 * replied STOP as a recipient while the server refused them: two answers to
 * one question, and the crew only ever saw the wrong one.
 */

/** The shape this needs from a customer. Deliberately minimal. */
export interface BlastNote {
  text: string;
  kind: string;
}

export interface BlastCandidate {
  id: string;
  phone: string;
  status: string;
  notes?: readonly BlastNote[] | null;
}

/**
 * Just enough of `canSendTo`'s answer for this module to act on it.
 *
 * Structural on purpose: the real function is handed in, so there is one
 * implementation of "may we text this person" and this module cannot drift
 * from it. Taking it as a parameter rather than importing it also keeps this
 * file import-free, which is what lets every rule below be run in a test.
 */
export interface ConsentVerdict {
  allowed: boolean;
  /** The sentence to show the crew. Empty when allowed. */
  reason: string;
}

/** Why somebody cannot be in a blast at all. */
export type BlastBlock = "do not knock" | "no phone" | "cannot be texted";

export interface BlastBlocked<T> {
  customer: T;
  /** The short label, for grouping and the one-line summary. */
  reason: BlastBlock;
  /**
   * The full explanation. For a consent refusal this is `canSendTo`'s own
   * wording, so the screen says "replied STOP" rather than a bare "skipped"
   * and nobody has to guess which of the two refusals applied.
   */
  detail: string;
}

export interface Audience<T> {
  /** Can be texted, has not had this message, and has not been taken out. */
  sendable: T[];
  /** Has already had this exact message on their timeline. */
  alreadySent: T[];
  /** Taken out by hand on this screen. */
  removed: T[];
  /** Cannot be texted at all, with the reason. */
  blocked: BlastBlocked<T>[];
  /**
   * A second or later record carrying a number already in `sendable`.
   *
   * One handset, one message. Without this the same person gets the blast
   * once per record they have, and the count promises more people than exist.
   */
  duplicates: T[];
}

/**
 * Two messages compared the way a person would.
 *
 * A text that came back from Firestore and one typed into a box differ in
 * ways nobody means: a trailing newline, a line break that became a space, a
 * double space after a full stop. Comparing them raw would say "not sent yet"
 * about a message somebody has already had, and they would get it twice.
 *
 * Case is folded for the same reason. What is NOT done is any kind of fuzzy
 * or partial match: two different offers that share an opening line are two
 * different messages, and treating them as one would silently drop people out
 * of the second send. Exact, once normalised.
 */
export function sameMessage(a: string, b: string): boolean {
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const left = normalize(a);
  // An empty draft matches nothing. Without this, every customer with any
  // outbound text would look like they had already had the blank message.
  if (!left) return false;
  return left === normalize(b);
}

/**
 * Whether this person has already had this exact message from us.
 *
 * Only outbound texts count. An inbound message quoting ours back, or a note
 * somebody typed containing the wording, is not us having sent it.
 */
export function hasReceivedMessage(
  notes: readonly BlastNote[] | null | undefined,
  body: string,
): boolean {
  if (!notes || !body.trim()) return false;
  return notes.some((note) => note.kind === "sms_out" && sameMessage(note.text, body));
}

/**
 * The last ten digits of a number, or null if it is not one.
 *
 * Deliberately the same arithmetic as phoneSuppressionKey in
 * lib/server/customerNotes.ts, so the screen and the server group a handset
 * the same way. A test imports both and asserts they still agree — if they
 * drift, the count shown stops matching the send.
 */
export function phoneGroupKey(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? digits : null;
}

/**
 * Lifts a per-record consent check to the number it belongs to.
 *
 * This is the fix for the audit's confirmed finding. `canSendTo` reads the
 * opt-out off ONE customer document, while an inbound STOP is written to
 * exactly one of the several records a handset can have — the Meta lead
 * webhook creates a fresh record per form submission. So a per-record check
 * passed every duplicate, and the screen showed the same person under
 * "cannot be texted" while also counting her as a recipient and sending.
 *
 * One record refusing is enough for every record on that number. A second
 * record without the mark is not a retraction of the first.
 */
function groupRefusals<T extends BlastCandidate>(
  customers: readonly T[],
  verdictFor: (customer: T) => ConsentVerdict,
): Map<string, string> {
  const refused = new Map<string, string>();
  for (const customer of customers) {
    const key = phoneGroupKey(customer.phone);
    if (!key || refused.has(key)) continue;
    const verdict = verdictFor(customer);
    if (!verdict.allowed) refused.set(key, verdict.reason);
  }
  return refused;
}

/**
 * Why this person cannot be in the blast, or null if they can.
 *
 * The first two are properties of the record. The third is the customer's own
 * decision, and it is delegated: `verdictFor` is `canSendTo`, the same
 * function /api/sms/blast runs before each message. Before it was asked here,
 * somebody who replied STOP was counted as a recipient and — if they happened
 * to have the wording on their timeline — listed as having already had it,
 * which is the screen claiming we sent a promotion to a person who opted out.
 *
 * `verdictFor` is required rather than defaulted. A default would have to mean
 * "no consent check", and a caller who forgot the argument would silently get
 * the old bug back; required makes that a compile error instead.
 */
export function blockFor<T extends BlastCandidate>(
  customer: T,
  verdictFor: (customer: T) => ConsentVerdict,
): BlastBlocked<T> | null {
  if (customer.status === "do_not_knock") {
    return { customer, reason: "do not knock", detail: "Marked do not knock." };
  }
  if (!customer.phone.trim()) {
    return { customer, reason: "no phone", detail: "No phone number on file." };
  }
  const verdict = verdictFor(customer);
  if (!verdict.allowed) {
    return { customer, reason: "cannot be texted", detail: verdict.reason };
  }
  return null;
}

/**
 * Splits the group on screen into who will receive this, who has had it, who
 * was taken out, and who cannot be texted.
 *
 * The order is the point. Being unable to receive a text outranks everything —
 * a do-not-knock customer, or one who replied STOP, is not "already sent",
 * they are off limits, and putting them in any other bucket is how they end up
 * counted as a recipient. Being taken out by hand outranks having already had
 * it, because that is a person making a decision and the screen should
 * reflect what they chose.
 *
 * Generic over the record so the caller keeps its own richer Customer type
 * back rather than a narrowed copy.
 */
export function splitAudience<T extends BlastCandidate>(
  customers: readonly T[],
  body: string,
  removedIds: ReadonlySet<string>,
  verdictFor: (customer: T) => ConsentVerdict,
): Audience<T> {
  const out: Audience<T> = {
    sendable: [],
    alreadySent: [],
    removed: [],
    blocked: [],
    duplicates: [],
  };

  // Every number that any record refuses, before judging any single record.
  const refusedNumbers = groupRefusals(customers, verdictFor);
  /** Numbers already counted as a recipient in this pass. */
  const claimed = new Set<string>();

  for (const customer of customers) {
    const key = phoneGroupKey(customer.phone);
    const groupReason = key ? refusedNumbers.get(key) : undefined;
    // A refusal recorded on ANY record for this number blocks them all, with
    // that record's own wording so the crew sees which refusal it was.
    const effectiveVerdict = groupReason
      ? () => ({ allowed: false, reason: groupReason })
      : verdictFor;

    const blocked = blockFor(customer, effectiveVerdict);
    if (blocked) {
      out.blocked.push(blocked);
      continue;
    }
    if (removedIds.has(customer.id)) {
      out.removed.push(customer);
      continue;
    }
    if (hasReceivedMessage(customer.notes, body)) {
      out.alreadySent.push(customer);
      continue;
    }
    // One handset, one message. Checked last, so a duplicate that is also
    // blocked, removed or already-sent reads as the truer of the two.
    if (key && claimed.has(key)) {
      out.duplicates.push(customer);
      continue;
    }
    if (key) claimed.add(key);
    out.sendable.push(customer);
  }

  return out;
}
