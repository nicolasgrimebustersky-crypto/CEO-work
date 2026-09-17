/**
 * Which business this data belongs to.
 *
 * Today there is exactly one: this file is the seam where a second one would
 * attach, not a feature in itself. Every collection carries an `orgId`, every
 * rule checks it, and there is a migration script to backfill it — but there
 * is no sign-up flow, no org-switcher, and no way yet to create a second org.
 * That is deliberate: the isolation has to be real and tested before there is
 * anything to isolate *from*.
 *
 * Free of imports, like lib/auth/roles.ts, so the rules, the server and the
 * browser can all agree on it without a build step in between.
 */

/**
 * The one organisation that exists. Every document written before this field
 * existed belongs to it implicitly — see `belongsToMyOrg()` in
 * firestore.rules, which treats a missing `orgId` as this value rather than
 * as "no org", so the backfill script can run at its own pace without a
 * moment where existing data becomes unreadable.
 *
 * Keep this in step with the fallback in firestore.rules' `myOrgId()`.
 */
export const DEFAULT_ORG_ID = "grime-busters";

/**
 * A stored orgId, or the org every document belonged to before this field
 * existed. The same defaulting `asPropertyType` in lib/property.ts uses for a
 * newer optional field — a missing or malformed value reads as the one thing
 * it can safely mean, rather than as an error or an empty org.
 */
export function asOrgId(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : DEFAULT_ORG_ID;
}
