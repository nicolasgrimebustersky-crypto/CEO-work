import "server-only";

import { adminAuth, adminDb } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/auth";
import { corsHeaders } from "@/lib/server/cors";
import { serializeCustomer, type SerialCustomer, type SerialDocument } from "@/lib/server/publicDocument";

/**
 * Who is on the other end of an account-portal request.
 *
 * A portal session is an ordinary Firebase Auth user who signed in with an
 * email link on grimebusterskyllc.com. The link proves they control the
 * address; this guard then finds every customer record carrying that address.
 * That lookup is the whole match — a customer never types anything the crew
 * has on file, and nothing in Firestore's rules changes, because every read
 * below goes through the Admin SDK and out through the same serializer the
 * share-token link uses.
 *
 * Consequence worth saying out loud: the email on a customer's record is the
 * key. A wrong address on a record is a wrong key.
 */
export const PORTAL_NO_RECORDS_MESSAGE =
  "We don't have any records under that email address yet. If you've worked with us " +
  "before, call (502) 599-6855 and we'll add it to your account.";

const MAX_RECORDS_PER_EMAIL = 30; // Firestore's ceiling for an `in` query, and far beyond real life.

export interface PortalCaller {
  uid: string;
  email: string;
  customerIds: string[];
  customers: SerialCustomer[];
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function requirePortalCustomer(request: Request): Promise<PortalCaller> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new ApiError(401, "Missing bearer token.");

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token, true);
  } catch {
    throw new ApiError(401, "Invalid or expired session. Sign in again.");
  }

  const email = normalizeEmail(decoded.email);
  if (!email || decoded.email_verified !== true) {
    throw new ApiError(403, "Sign in with the link we emailed you so we can confirm your address.");
  }

  const snap = await adminDb()
    .collection("customers")
    .where("email", "==", email)
    .limit(MAX_RECORDS_PER_EMAIL)
    .get();

  const customers = snap.docs
    .map((doc) => serializeCustomer(doc))
    .filter((customer): customer is SerialCustomer => customer !== null);

  if (customers.length === 0) throw new ApiError(404, PORTAL_NO_RECORDS_MESSAGE);

  return { uid: decoded.uid, email, customerIds: customers.map((c) => c.id), customers };
}

/**
 * Errors the portal page can read across origins. The generic errorResponse
 * is right for the crew app; a browser on grimebusterskyllc.com only sees a
 * response that carries CORS headers, and the "no records yet" answer is the
 * one a customer most needs to actually read.
 */
export function portalError(request: Request, error: unknown): Response {
  const known = error instanceof ApiError;
  if (!known) console.error("portal error", error);
  return Response.json(
    { error: known ? error.message : "Something went wrong. Please try again." },
    { status: known ? error.status : 500, headers: corsHeaders(request) },
  );
}

/**
 * A document as the portal hands it to the browser. The share token is
 * dropped: the customer is already looking at the document, and the token is
 * the one credential that would let somebody else look at it too.
 */
export function forPortal(document: SerialDocument): SerialDocument {
  return { ...document, shareToken: null };
}
