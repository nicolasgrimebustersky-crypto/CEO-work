/**
 * Who is allowed in, and who decides.
 *
 * Two separate questions, kept separate on purpose:
 *
 *   Can you use the app?      `role` on your profile — crew, or pending
 *   Can you let others in?    your email address, and nothing else
 *
 * The second is deliberately *not* a stored field. If "admin" were a role in
 * the database, then anybody who could write that field could mint an admin,
 * and the one account that matters would be only as safe as every write path
 * in the app. Deriving it from the signed-in email means there is exactly one
 * admin, it cannot be granted, and a compromised database cannot create
 * another one.
 *
 * Access itself still works the way it did: registering gets you `pending`,
 * which can sign in and see nothing until the admin approves you. Everything
 * real — customers, jobs, invoices, messages — stays denied until then,
 * because this database holds real people's home addresses.
 *
 * Free of imports so the tests, the server and the browser can all use it.
 */

/** Anything not literally "crew" is pending. See `roleFor`. */
export type Role = "crew" | "pending";

/**
 * Who holds the keys, per brand. Each brand runs its own Firebase project
 * (lib/brand.ts), so each has its own admin and founding accounts — and they
 * must never be another brand's, or one business's owner could sign in to
 * the other's customers.
 *
 * Read inline from NEXT_PUBLIC_BRAND, like lib/messages.ts, so this file stays
 * import-free. The same values are written into each brand's rules:
 * firestore.rules and storage.rules for Grime Busters, and rules/<brand>/ for
 * the rest, rendered by scripts/brand-rules.mjs. `tests/roles.test.mjs` and
 * `tests/brand.test.mjs` check they agree.
 *
 * An empty adminEmail means the brand has no admin yet. isAdmin() then
 * matches nobody, and lib/brandGuard.ts refuses a live build for it.
 */
export interface AccessIdentity {
  adminEmail: string;
  bootstrapCrew: readonly string[];
  ownerUid: string;
}

export const ACCESS_IDENTITIES: Record<"grime-busters" | "rda", AccessIdentity> = {
  "grime-busters": {
    adminEmail: "nicolas.grimebustersky@gmail.com",
    bootstrapCrew: ["Bzo7rclax4SdT7PaAua1monNxXG3", "QLMsTAHbbceHBAWBXPqtScGdGon2"],
    ownerUid: "Bzo7rclax4SdT7PaAua1monNxXG3",
  },
  rda: {
    // Ryland's Google sign-in address, in lower case. Set it, then run
    // `node --experimental-strip-types scripts/brand-rules.mjs rda`.
    adminEmail: "",
    // His Firebase uid once he has signed up in RDA's own project. Until then
    // he is crew through the admin email, but job photos (storage.rules)
    // admit only these uids.
    bootstrapCrew: [],
    ownerUid: "",
  },
};

const IDENTITY =
  process.env.NEXT_PUBLIC_BRAND === "rda" ? ACCESS_IDENTITIES.rda : ACCESS_IDENTITIES["grime-busters"];

/**
 * The single admin. Firebase enforces one account per email address, so this
 * cannot be claimed by registering — and it is checked against the signed-in
 * token, not against anything a client can send.
 *
 * If this address ever changes in Firebase, change it in ACCESS_IDENTITIES and
 * in the brand's rules together. `tests/roles.test.mjs` checks they agree.
 */
export const ADMIN_EMAIL = IDENTITY.adminEmail;

/**
 * Crew regardless of what is stored — the founding accounts.
 *
 * Keep in step with the same list in the brand's firestore.rules and
 * storage.rules. This is the bootstrap: the first accounts cannot wait for an
 * approver, and a profile damaged by a bad write must never lock the owners
 * out of their own business.
 */
export const BOOTSTRAP_CREW: readonly string[] = IDENTITY.bootstrapCrew;

/**
 * The owner's account, for the one notification that is addressed rather than
 * broadcast: a job signed off on site, with the amount and whether the money
 * was collected.
 *
 * A uid rather than an email because notifications are addressed by uid, and
 * the roster carries no email to match on. For Grime Busters it is the first
 * bootstrap account — the same uid the legacy import scripts write as
 * "Nicolas". Empty when a brand's owner has no uid yet; the sign-off then
 * addresses nobody rather than somebody else.
 *
 * Safe to hold in client code: it addresses a message, it does not grant
 * anything. Permission still comes from `isAdmin`, which is checked against the
 * signed-in token.
 */
export const OWNER_UID = IDENTITY.ownerUid;

export function isBootstrapCrew(uid: string | null | undefined): boolean {
  return typeof uid === "string" && BOOTSTRAP_CREW.includes(uid);
}

/**
 * Can this person grant and remove other people's access?
 *
 * Compared case-insensitively and trimmed, because an email that differs only
 * in case is the same mailbox and the same Firebase account — but never
 * loosely: no prefix matching, no domain matching, no "starts with".
 */
export function isAdmin(email: string | null | undefined): boolean {
  // No admin configured matches nobody — never the empty string a missing
  // token email would trim to.
  if (typeof email !== "string" || !ADMIN_EMAIL) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL;
}

/**
 * The effective role for an account.
 *
 * Anything that is not literally the string "crew" is pending. Written that
 * way on purpose: a missing field, a null, a typo, or a value invented by a
 * future version all fail closed. The opposite reading — "not pending, so
 * crew" — turns any storage mishap into an open door.
 */
export function roleFor(uid: string | null | undefined, storedRole: unknown): Role {
  if (isBootstrapCrew(uid)) return "crew";
  return storedRole === "crew" ? "crew" : "pending";
}

/**
 * Can this person use the app at all?
 *
 * The admin always can — an admin locked out by their own profile could never
 * reach the screen that fixes it.
 */
export function isCrew(
  uid: string | null | undefined,
  storedRole: unknown,
  email?: string | null,
): boolean {
  if (isAdmin(email)) return true;
  return roleFor(uid, storedRole) === "crew";
}

/**
 * What a newly registered account is written with. Never "crew" — the whole
 * point is that granting access is a deliberate act by the admin.
 */
export const SIGNUP_ROLE: Role = "pending";
