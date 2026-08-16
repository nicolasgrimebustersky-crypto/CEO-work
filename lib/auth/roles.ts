/**
 * Who is allowed in.
 *
 * The app used to answer this with a hardcoded list of two uids. Opening sign
 * up means anybody can create an account, so the question becomes: what can a
 * brand new account do?
 *
 * The answer here is *nothing*. Registering gets you a profile marked
 * `pending`, which can sign in and see a screen saying somebody has to let you
 * in. Every customer name, phone number, address, invoice and message stays
 * denied until an existing crew member approves you.
 *
 * That default is not caution for its own sake. This database holds real
 * customers' home addresses and phone numbers; a sign-up form that granted
 * access on submit would mean anyone who found the URL could read all of it.
 *
 * Two uids are crew unconditionally, whatever their profile says. They are the
 * bootstrap: the first account cannot wait for an approver who does not exist
 * yet, and a profile document damaged by a bad write must never be able to lock
 * both owners out of their own business.
 *
 * Free of imports so the rules tests and the server can both use it, and so it
 * can be tested by running it.
 */

export type Role = "crew" | "pending";

/**
 * Always crew, regardless of what is stored. Keep in step with the same list in
 * firestore.rules — that file is the enforcement, this is the app agreeing with
 * it. `tests/roles.test.mjs` checks they have not drifted apart.
 */
export const BOOTSTRAP_CREW: readonly string[] = [
  "Bzo7rclax4SdT7PaAua1monNxXG3",
  "QLMsTAHbbceHBAWBXPqtScGdGon2",
];

export function isBootstrapCrew(uid: string | null | undefined): boolean {
  return typeof uid === "string" && BOOTSTRAP_CREW.includes(uid);
}

/**
 * The effective role for an account.
 *
 * Anything that is not literally the string "crew" is pending. Written that way
 * on purpose: a missing field, a null, a typo, or a value invented by a future
 * version all fail closed. The opposite reading — "not pending, so crew" —
 * turns any storage mishap into an open door.
 */
export function roleFor(uid: string | null | undefined, storedRole: unknown): Role {
  if (isBootstrapCrew(uid)) return "crew";
  return storedRole === "crew" ? "crew" : "pending";
}

export function isCrew(uid: string | null | undefined, storedRole: unknown): boolean {
  return roleFor(uid, storedRole) === "crew";
}

/**
 * What a newly registered account is written with. Never "crew" — the whole
 * point is that granting access is a deliberate act by somebody already inside.
 */
export const SIGNUP_ROLE: Role = "pending";
