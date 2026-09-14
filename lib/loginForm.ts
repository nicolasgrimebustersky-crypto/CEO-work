/**
 * What the login screen checks before it talks to Firebase.
 *
 * Firebase will refuse a bad email or a short password on its own, but only
 * after a round trip, and its answer arrives as an error code that has to be
 * translated. Catching the obvious cases here means the person at the door
 * sees the problem the moment they tap, in words — and it means the one check
 * Firebase cannot do, that the two password boxes agree, has somewhere to live.
 *
 * Free of imports so the rules can be run directly in a test.
 */

/** Firebase's own minimum. Stated up front rather than after a failed submit. */
export const MIN_PASSWORD = 6;

export interface SignInInput {
  email: string;
  password: string;
}

export interface RegisterInput extends SignInInput {
  name: string;
  confirm: string;
}

/**
 * Loose on purpose. This is a tripwire for a name typed in the email box, not
 * an address validator — Firebase is the authority, and no regular expression
 * gets RFC 5322 right anyway.
 */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  const at = trimmed.indexOf("@");
  return at > 0 && at === trimmed.lastIndexOf("@") && trimmed.slice(at + 1).includes(".");
}

/** The first thing wrong with a sign-in attempt, in words, or null. */
export function signInProblem(input: SignInInput): string | null {
  if (!input.email.trim()) return "Enter your email address.";
  if (!looksLikeEmail(input.email)) return "That email address isn't valid.";
  if (!input.password) return "Enter your password.";
  return null;
}

/** The first thing wrong with a registration, in words, or null. */
export function registerProblem(input: RegisterInput): string | null {
  if (!input.name.trim()) return "Enter your name — it's what the crew will see on your notes.";
  if (!input.email.trim()) return "Enter your email address.";
  if (!looksLikeEmail(input.email)) return "That email address isn't valid.";
  if (!input.password) return "Choose a password.";
  if (input.password.length < MIN_PASSWORD) {
    return `Pick a password of at least ${MIN_PASSWORD} characters.`;
  }
  // Compared exactly. Trimming would let "secret " and "secret" pass together,
  // and then only one of them would open the account tomorrow.
  if (input.password !== input.confirm) return "The two passwords don't match.";
  return null;
}

/**
 * Whether a reset link can be requested for what is in the email box.
 *
 * The reset lives on the sign-in form as a link rather than a separate screen,
 * so the address it uses is whatever has been typed so far — which may be
 * nothing. The answer has to say so rather than silently sending nowhere.
 */
export function resetProblem(email: string): string | null {
  if (!email.trim()) return "Enter your email address above first, then tap this again.";
  if (!looksLikeEmail(email)) return "That email address isn't valid.";
  return null;
}
