/**
 * Deciding which customer records a signed-in person is allowed to see.
 *
 * This is the whole security boundary of the customer portal, so it is written
 * as pure functions and tested directly rather than inferred from a working
 * page. Everything here answers one question: given something the person has
 * *proven* — an email Firebase verified, or a phone number Firebase sent a code
 * to — which records in the database are theirs?
 *
 * A name is never part of that answer. Two customers are called John Smith,
 * names are not secret, and "knows the name on the account" is not proof of
 * anything. The proof is always possession of an inbox or a handset.
 */

/**
 * The stored form of a phone number, for looking one up.
 *
 * Customer phones are typed by hand on a porch — "(502) 555-0100",
 * "502-555-0100", "15025550100" are all the same number and all appear in the
 * data. Firebase hands back strict E.164 ("+15025550100"). Neither side can be
 * matched against the other as text, so both go through this first.
 *
 * Null when the number is not one we can be confident about. A half-typed
 * number must not normalise into *somebody else's* valid number, so anything
 * that is not plainly a US 10- or 11-digit number is refused rather than
 * padded, truncated or guessed.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  const digits = value.replace(/\D/g, "");

  // The same US assumption toE164 in lib/format.ts makes — that is the whole
  // service area — and deliberately the same arithmetic, so a number texted by
  // Twilio and a number matched here cannot disagree. Duplicated rather than
  // imported so this module keeps no dependencies and stays testable on its
  // own; a test imports both and asserts they still agree.
  let e164: string | null = null;
  if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else if (value.startsWith("+")) e164 = value;

  if (!e164) return null;
  // A leading "+" is not proof of a phone number, and this value becomes a
  // database lookup key. Confirm the shape before it does.
  return /^\+\d{11,15}$/.test(e164) ? e164 : null;
}

/** Lower-cased and trimmed, the form an email is stored and compared in. */
export function emailKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = String(raw).trim().toLowerCase();
  return clean.includes("@") && clean.length > 2 ? clean : null;
}

export interface VerifiedIdentity {
  /** Present only when Firebase confirmed the address. */
  email: string | null;
  /** Present only when Firebase confirmed the handset by SMS. */
  phone: string | null;
}

/**
 * What a decoded Firebase token proves, reduced to the two things we match on.
 *
 * `email_verified` is required for the email, and is the difference between
 * "typed an address" and "controls that inbox". A phone number on the token is
 * verified by construction — Firebase only sets it after a code was received —
 * so there is no equivalent flag to check.
 */
export function verifiedIdentity(token: {
  email?: unknown;
  email_verified?: unknown;
  phone_number?: unknown;
}): VerifiedIdentity {
  const email = token.email_verified === true ? emailKey(token.email as string) : null;
  const phone = phoneKey(token.phone_number as string);
  return { email, phone };
}

/** True when this identity proves nothing we can match on. */
export function isAnonymous(identity: VerifiedIdentity): boolean {
  return !identity.email && !identity.phone;
}

/**
 * Whether a stored customer record belongs to a verified identity.
 *
 * Either side matching is enough, and both are compared in normalised form.
 * A record with neither field set matches nothing — an empty stored phone must
 * never equal an empty anything, which is the classic way a lookup like this
 * hands one person the whole database.
 */
export function recordBelongsTo(
  record: { email?: string | null; phoneE164?: string | null; phone?: string | null },
  identity: VerifiedIdentity,
): boolean {
  if (identity.email) {
    const stored = emailKey(record.email);
    if (stored && stored === identity.email) return true;
  }
  if (identity.phone) {
    // phoneE164 is the stored normalised field; `phone` is the hand-typed one,
    // normalised here as a fallback for records written before that field
    // existed.
    const stored = phoneKey(record.phoneE164) ?? phoneKey(record.phone);
    if (stored && stored === identity.phone) return true;
  }
  return false;
}

/**
 * How many records one identity may pull back.
 *
 * A commercial customer legitimately has several site records under one
 * contact, so this cannot be 1. It is a ceiling rather than a page size: if a
 * single email or phone matches more than this, something is wrong with the
 * data — or somebody is fishing — and the right move is to stop rather than
 * stream out an unbounded slice of the customer table.
 */
export const MAX_RECORDS_PER_IDENTITY = 25;

export interface ClaimAttempt {
  /** The document number as printed, e.g. "EST-1042". */
  number: string;
  /** The total as typed, in dollars. */
  total: number;
}

export interface ClaimTarget {
  number: string;
  total: number;
}

/**
 * Whether a claim proves the person is holding the document.
 *
 * The problem this solves: document numbers continue a sequence, so they are
 * guessable by design — if EST-1042 is yours, EST-1041 is your neighbour's.
 * A claim on the number alone would let somebody walk the sequence and attach
 * themselves to other people's records, which is the opposite of what the
 * portal is for.
 *
 * So the total has to match as well. It is printed on the same document, it is
 * not derivable from the number, and guessing it is much harder than counting
 * down. Both are required, and both are compared exactly — a cent of tolerance
 * is allowed only because the customer is reading a rounded figure off paper.
 */
export function claimMatches(attempt: ClaimAttempt, target: ClaimTarget): boolean {
  // Everything but letters and digits is dropped from both sides, so "EST 1042",
  // "est-1042" and "EST1042" are the same claim. Forgiving the separator costs
  // nothing: the total below is what actually stands between a guessed number
  // and somebody else's record, and no amount of punctuation makes that easier.
  const key = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const typed = key(attempt.number);
  const real = key(target.number);
  if (!typed || typed !== real) return false;
  if (!Number.isFinite(attempt.total) || !Number.isFinite(target.total)) return false;
  return Math.abs(attempt.total - target.total) < 0.005;
}
