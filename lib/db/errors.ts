/**
 * Turning a Firestore error into something you can act on.
 *
 * "Missing or insufficient permissions." is what the SDK says, and it is the
 * least useful true sentence available. It appears for two completely
 * different situations, and the fix for each is somewhere else entirely:
 *
 *   The security rules in the repo have not been deployed to Firebase, so a
 *   collection the app knows about does not exist as far as the database is
 *   concerned. Everything on that screen fails and nothing else does. This is
 *   overwhelmingly the common case right after a feature ships — rules deploy
 *   separately from the app, so shipping the code is only half of it.
 *
 *   The account genuinely is not allowed. Somebody registered and has not been
 *   approved, or their access was removed.
 *
 * Naming the collection is what separates them from the outside: one screen
 * broken points at a missing rule, every screen broken points at the account.
 *
 * Free of imports so it can be tested by running it.
 */

/** What the Firestore SDK raises when rules refuse a read or a write. */
const DENIED = "permission-denied";

interface MaybeFirebaseError {
  code?: unknown;
  message?: unknown;
}

function isDenied(error: unknown): boolean {
  const candidate = error as MaybeFirebaseError;
  if (typeof candidate?.code === "string" && candidate.code.includes(DENIED)) {
    return true;
  }
  // Older SDK paths and re-thrown errors lose the code and keep only the
  // sentence, so match that too rather than falling through to a generic
  // message for the case this function exists to explain.
  return (
    typeof candidate?.message === "string" &&
    /missing or insufficient permissions/i.test(candidate.message)
  );
}

/**
 * A sentence to put in front of somebody, given whatever went wrong.
 *
 * `what` names the thing that could not be loaded — "routes", "chats" — and is
 * used to make the explanation concrete rather than generic.
 */
export function friendlyError(error: unknown, what: string): string {
  if (!isDenied(error)) {
    if (error instanceof Error && error.message) return error.message;
    return `Could not load ${what}.`;
  }

  return (
    `Can't load ${what} — the database is refusing it. ` +
    `If the rest of the app works, the security rules need deploying ` +
    `(firebase deploy --only firestore:rules). ` +
    `If nothing works, your account hasn't been approved yet.`
  );
}
