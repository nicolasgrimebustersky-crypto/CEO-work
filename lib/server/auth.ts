import "server-only";

import { adminAuth } from "./admin";

/**
 * The server-side half of the two-account allowlist. `firestore.rules` protects
 * direct client reads and writes, but API routes run with the Admin SDK, which
 * bypasses rules entirely — so every route re-checks the caller here.
 *
 * Keep CREW_UIDS in sync with the allowlist in firestore.rules and
 * storage.rules. An empty value fails every request rather than allowing them:
 * an SMS endpoint that anyone can reach is toll fraud waiting to happen.
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
export async function requireCrew(request: Request): Promise<CrewCaller> {
  const allowlist = crewUids();
  if (allowlist.length === 0) {
    throw new ApiError(
      500,
      "CREW_UIDS is not configured, so no request can be authorised. See the README.",
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new ApiError(401, "Missing bearer token.");

  let decoded;
  try {
    // checkRevoked: a signed-out or disabled account must stop working
    // immediately, not when its hour-long token happens to expire.
    decoded = await adminAuth().verifyIdToken(token, true);
  } catch {
    throw new ApiError(401, "Invalid or expired session.");
  }

  if (!allowlist.includes(decoded.uid)) {
    throw new ApiError(403, "This account is not on the crew allowlist.");
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

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return Response.json({ error: message }, { status: 500 });
}
