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
    // phoneE164 is the stored normalised field and the only one a Firestore
    // query can match on. The typed `phone` is checked too, but only by callers
    // that already hold a record — the claim route, and tests. A record whose
    // phoneE164 is unset is NOT findable by sign-in, which is exactly what
    // scripts/backfill-phone-e164.mjs exists to fix, and why it has to be run
    // before phone sign-in works for existing customers.
    const stored = phoneKey(record.phoneE164) ?? phoneKey(record.phone);
    if (stored && stored === identity.phone) return true;
  }
  return false;
}

/**
 * How many records one identity may pull back.
 *
 * A commercial customer legitimately has several site records under one
 * contact, so this cannot be 1. It is also a hard ceiling rather than a
 * preference: the portal's document and job routes run
 * `.where("customerId", "in", ids)`, and Firestore rejects that above 30. Both
 * the query limits and the post-merge cap use this one value — they were
 * briefly two constants with different numbers, which meant the test guarding
 * the ceiling was guarding nothing.
 */
export const MAX_RECORDS_PER_IDENTITY = 30;

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
  // Compared on digits alone, on both sides.
  //
  // Stored numbers are bare digits — nextNumber() returns String(n) — and the
  // document prints them as "#8904", so a customer copying their own paperwork
  // types "8904", "#8904", or occasionally "EST 8904" because that is what an
  // estimate looks like to them. All three mean the same document, and the
  // claim route's Firestore lookup already narrows by digits, so matching on
  // anything narrower here would reject claims the query had just found.
  //
  // Safe because the number was never the secret: it runs in a sequence and is
  // guessable by design. The total below is the whole guard. Worth revisiting
  // only if numbers ever gain a meaningful prefix — if estimates and invoices
  // stopped sharing one sequence, "EST-12" and "INV-12" would collide here.
  const key = (value: string) => value.replace(/\D/g, "");
  const typed = key(attempt.number);
  const real = key(target.number);
  if (!typed || typed !== real) return false;
  if (!Number.isFinite(attempt.total) || !Number.isFinite(target.total)) return false;
  return Math.abs(attempt.total - target.total) < 0.005;
}
