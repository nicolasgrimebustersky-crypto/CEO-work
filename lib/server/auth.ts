import "server-only";

import { isAdmin, isBootstrapCrew } from "@/lib/auth/roles";
import { adminAuth, adminDb, isAdminConfigured } from "./admin";
import { corsHeaders } from "./cors";

/**
 * The server-side half of the access model. `firestore.rules` protects direct
 * client reads and writes, but API routes run with the Admin SDK, which
 * bypasses rules entirely — so every route re-checks the caller here.
 *
 * Two ways to be crew, matching the rules exactly:
 *
 *   admin      the one account that grants access, identified by email
 *   CREW_UIDS  the bootstrap accounts, always allowed
 *   role       an account the admin approved, stored on its profile
 *
 * The second is why sign-up being open does not open these endpoints: a fresh
 * registration has role 'pending' and is refused here as well, so it cannot
 * spend the Twilio balance any more than it can read a customer.
 *
 * Keep CREW_UIDS in sync with the uid list in firestore.rules, storage.rules
 * and lib/auth/roles.ts. An empty value still fails every bootstrap check
 * rather than allowing them: an SMS endpoint anyone can reach is toll fraud
 * waiting to happen.
 */
function crewUids(): string[] {
  return (process.env.CREW_UIDS ?? "")
    .split(",")
    .map((uid) => uid.trim())
    .filter(Boolean);
}

export interface CrewCaller {
  uid: string;
  displayName: string;
  email: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Verifies the Firebase ID token on an incoming request and confirms the caller
 * is one of the two crew accounts. Throws ApiError, which the route handlers
 * turn into a JSON response.
 */
/**
 * Has this account been approved? Read from the profile with the Admin SDK.
 *
 * Compared against the literal 'crew': a missing document, a missing field or
 * a typo all come back false. Fails closed by construction rather than by
 * remembering to handle each case.
 */
async function isApprovedCrew(uid: string): Promise<boolean> {
  try {
    const snap = await adminDb().collection("users").doc(uid).get();
    return snap.exists && snap.data()?.role === "crew";
  } catch {
    // A Firestore outage must not promote anybody.
    return false;
  }
}

export async function requireCrew(request: Request): Promise<CrewCaller> {
  const allowlist = crewUids();

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new ApiError(401, "Missing bearer token.");

  // Checked before the token is, because otherwise it cannot be. Without the
  // service account the Admin SDK throws on the very first call, and that throw
  // lands in the catch below and comes back to the operator as "invalid or
  // expired session" — pointing them at their own login when the actual fault
  // is a missing deployment variable. That is an hour of looking in the wrong
  // place, so the two are named separately.
  if (!isAdminConfigured) {
    throw new ApiError(
      503,
      "This deployment is missing FIREBASE_SERVICE_ACCOUNT_KEY, so the server cannot check who is signed in. Nothing is wrong with your login — set it in the hosting environment and redeploy.",
    );
  }

  let decoded;
  try {
    // checkRevoked: a signed-out or disabled account must stop working
    // immediately, not when its hour-long token happens to expire.
    decoded = await adminAuth().verifyIdToken(token, true);
  } catch {
    throw new ApiError(401, "Invalid or expired session. Sign out and back in.");
  }

  const allowed =
    isAdmin(decoded.email) ||
    allowlist.includes(decoded.uid) ||
    isBootstrapCrew(decoded.uid) ||
    (await isApprovedCrew(decoded.uid));

  if (!allowed) {
    throw new ApiError(
      403,
      "This account has not been approved yet. Ask one of the crew to let you in from their Account screen.",
    );
  }

  return {
    uid: decoded.uid,
    displayName:
      typeof decoded.name === "string" && decoded.name ? decoded.name : "Unknown",
    email: typeof decoded.email === "string" ? decoded.email : null,
  };
}

/**
 * Vercel cron jobs authenticate with a shared secret rather than a user token.
 * Same fail-closed rule: no secret configured means the endpoint is unreachable.
 */
export function requireCronSecret(request: Request): void {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) {
    throw new ApiError(500, "CRON_SECRET is not configured.");
  }
  const header = request.headers.get("authorization") ?? "";
  if (header !== `Bearer ${secret}`) {
    throw new ApiError(401, "Bad cron secret.");
  }
}

/**
 * Error responses carry CORS headers too. Without them the iOS app sees an
 * opaque network failure instead of "rate limit reached" or "not on the crew
 * allowlist", which is exactly when a clear message matters most.
 */
export function errorResponse(error: unknown, request?: Request): Response {
  const status = error instanceof ApiError ? error.status : 500;
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Unexpected server error.";

  return Response.json(
    { error: message },
    { status, headers: request ? corsHeaders(request) : {} },
  );
}
