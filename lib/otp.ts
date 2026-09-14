/**
 * The second step of signing in: a six-digit code, emailed.
 *
 * What makes this real rather than decorative is where it is enforced. Every
 * Firebase ID token carries `auth_time`, the moment of the password sign-in.
 * When a code is verified, the server records that `auth_time` in a custom
 * claim on the account — a short list of the sign-ins that have passed. The
 * Firestore rules and every API route then allow a session only if its own
 * `auth_time` is in that list.
 *
 * So: every fresh password sign-in needs a code. A phone that passed the check
 * stays passed — its `auth_time` does not change on token refresh. And one
 * device passing the check never unlocks another that has not, because the
 * list holds sign-in moments, not a single "verified" flag. A flag would have
 * exactly that hole: a thief who signs in while the owner's flag is fresh
 * would walk straight through.
 *
 * Free of imports so the client, the server, the rules tests and this file's
 * own tests all read the same three rules.
 */

export const OTP_LENGTH = 6;
/** How long a code is good for. */
export const OTP_TTL_MS = 10 * 60 * 1000;
/** Wrong guesses before the code is thrown away. Six digits is a million. */
export const OTP_MAX_ATTEMPTS = 5;
/** Seconds before the screen offers to send another. */
export const OTP_RESEND_SECONDS = 45;
/**
 * How many sign-ins the claim remembers. Custom claims are capped at 1,000
 * bytes; twelve integers is under 150. A crew member signing in on a
 * thirteenth device just pushes the oldest one out, and that device — if it
 * still exists — asks for a code again. Nothing else changes.
 */
export const VERIFIED_SESSIONS_KEPT = 12;

/** The custom claim. Keep in step with firestore.rules and storage.rules. */
export const OTP_CLAIM = "otpAuths";

/** Only the digits, at most six. What every input path funnels through. */
export function digitsOnly(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\D+/g, "").slice(0, OTP_LENGTH);
}

export function isCompleteCode(value: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(value);
}

/**
 * "nicolas.grimebustersky@gmail.com" → "ni•••••@gmail.com".
 *
 * Enough for the person to recognise their own address on the screen, not
 * enough to be worth reading over a shoulder.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}${"•".repeat(Math.max(3, local.length - keep.length))}${email.slice(at)}`;
}

/** The shape of the token claims the check reads. Everything optional on purpose. */
export interface SessionClaims {
  auth_time?: unknown;
  [OTP_CLAIM]?: unknown;
}

/**
 * Has THIS sign-in passed the code?
 *
 * The one rule the whole feature rests on, so it is deliberately strict about
 * types: an `auth_time` that is not a whole number, or a claim that is not a
 * list, is a no — never a maybe.
 */
export function sessionIsVerified(claims: SessionClaims): boolean {
  const authTime = claims.auth_time;
  const verified = claims[OTP_CLAIM];
  if (typeof authTime !== "number" || !Number.isInteger(authTime)) return false;
  if (!Array.isArray(verified)) return false;
  return verified.includes(authTime);
}

/**
 * The claim after this sign-in passes.
 *
 * Whatever was there is kept if it is a whole number, this sign-in is added,
 * duplicates collapse, and only the most recent few survive. Sorted so the
 * "most recent" cut is by sign-in time, not by the order somebody happened to
 * verify in.
 */
export function withVerifiedSession(existing: unknown, authTime: number): number[] {
  const kept = Array.isArray(existing)
    ? existing.filter((value): value is number => typeof value === "number" && Number.isInteger(value))
    : [];
  const merged = [...new Set([...kept, authTime])].sort((a, b) => a - b);
  return merged.slice(-VERIFIED_SESSIONS_KEPT);
}

/**
 * Typing or pasting into one of the six boxes.
 *
 * One function for every way digits arrive — a single keystroke, a paste of
 * the whole code, iOS autofilling all six into the first box — so the boxes
 * cannot disagree about what happens. Returns the new boxes and where focus
 * should land: the box after the last one filled, or the last box.
 */
export function placeDigits(
  boxes: readonly string[],
  at: number,
  typed: string,
): { boxes: string[]; focus: number } {
  const next = [...boxes];
  const digits = digitsOnly(typed);
  if (!digits) {
    next[at] = "";
    return { boxes: next, focus: at };
  }
  let index = at;
  for (const digit of digits) {
    if (index >= OTP_LENGTH) break;
    next[index] = digit;
    index += 1;
  }
  return { boxes: next, focus: Math.min(index, OTP_LENGTH - 1) };
}

/** Backspace in an empty box moves back and clears the one before it. */
export function eraseDigit(
  boxes: readonly string[],
  at: number,
): { boxes: string[]; focus: number } {
  const next = [...boxes];
  if (next[at]) {
    next[at] = "";
    return { boxes: next, focus: at };
  }
  const previous = Math.max(0, at - 1);
  next[previous] = "";
  return { boxes: next, focus: previous };
}

export function emptyBoxes(): string[] {
  return Array.from({ length: OTP_LENGTH }, () => "");
}
