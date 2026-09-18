import "server-only";

import { adminAuth, adminDb } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/auth";
import { corsHeaders } from "@/lib/server/cors";
import { serializeCustomer, type SerialCustomer, type SerialDocument } from "@/lib/server/publicDocument";
import {
  isAnonymous,
  verifiedIdentity,
  type VerifiedIdentity,
} from "@/lib/portalMatch";

/**
 * Who is on the other end of an account-portal request.
 *
 * A portal session is an ordinary Firebase Auth user who signed in on
 * grimebusterskyllc.com — by a code texted to their phone, or by an email
 * link. Either way what they hold is proof of *possession*: a handset that
 * received an SMS, or an inbox that received a link. This guard then finds
 * every customer record carrying that phone or that address.
 *
 * That possession is the whole match. A customer never types a name, and a
 * name would never be accepted if they did — two customers are called John
 * Smith, and knowing the name on an account proves nothing about owning it.
 *
 * Nothing in Firestore's rules changes: every read below goes through the
 * Admin SDK and out through the same serializer the share-token link uses.
 *
 * Consequence worth saying out loud: the phone and email on a customer's
 * record are the keys. A wrong number on a record is a wrong key — the
 * customer signs in and sees nothing, which is the safe direction to fail.
 */
export const PORTAL_NO_RECORDS_MESSAGE =
  "We don't have any records under that phone number or email yet. If you've worked " +
  "with us before, you can link your account with an estimate or invoice number — " +
  "or call (502) 599-6855 and we'll do it for you.";

/**
 * Firestore's ceiling for an `in` query, and far beyond real life.
 *
 * This is a hard limit rather than a preference: the portal's document and job
 * routes both run `.where("customerId", "in", caller.customerIds)`, and
 * Firestore rejects that outright above 30 ids. Matching now runs one query per
 * proven identifier, so the merged set has to be capped here or a customer with
 * both a phone and an email on many site records would sign in to an error.
 */
const MAX_RECORDS_PER_IDENTITY = 30;

export interface PortalCaller {
  uid: string;
  /** What Firebase actually verified. Either side may be null, never both. */
  identity: VerifiedIdentity;
  /** The verified email, or "" when they signed in by phone. Kept for callers that log it. */
  email: string;
  customerIds: string[];
  customers: SerialCustomer[];
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Who is signed in, without requiring that we already know them.
 *
 * requirePortalCustomer answers 404 when no record carries the caller's phone
 * or email — which is right for reading, and exactly wrong for claiming, since
 * having no records is the reason somebody is claiming in the first place. This
 * is the same token check without that last step.
 */
export async function requirePortalIdentity(
  request: Request,
): Promise<{ uid: string; identity: VerifiedIdentity }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new ApiError(401, "Missing bearer token.");

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token, true);
  } catch {
    throw new ApiError(401, "Invalid or expired session. Sign in again.");
  }

  const identity = verifiedIdentity(decoded);
  if (isAnonymous(identity)) {
    throw new ApiError(
      403,
      "Confirm your phone number or email address so we can find your records.",
    );
  }
  return { uid: decoded.uid, identity };
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

  const identity = verifiedIdentity(decoded);
  if (isAnonymous(identity)) {
    // Signed in, but with nothing we can match on: an unverified email, or an
    // anonymous/custom-token session. Refused rather than matched loosely.
    throw new ApiError(
      403,
      "Confirm your phone number or email address so we can find your records.",
    );
  }

  const db = adminDb();

  // One query per proven identifier rather than one query over both. Firestore
  // cannot OR across two fields, and the alternative — reading the collection
  // and filtering in memory — would mean a full customer-table read on every
  // sign-in, which is both slow and a much larger blast radius if the filter
  // is ever wrong.
  const queries = [];
  if (identity.email) {
    queries.push(db.collection("customers").where("email", "==", identity.email).limit(MAX_RECORDS_PER_IDENTITY).get());
  }
  if (identity.phone) {
    queries.push(
      db.collection("customers").where("phoneE164", "==", identity.phone).limit(MAX_RECORDS_PER_IDENTITY).get(),
    );
  }

  const results = await Promise.all(queries);

  // De-duplicated by id: somebody whose record carries both their email and
  // their phone comes back from both queries and is still one customer.
  const byId = new Map<string, SerialCustomer>();
  for (const snap of results) {
    for (const doc of snap.docs) {
      const customer = serializeCustomer(doc);
      if (customer) byId.set(customer.id, customer);
    }
  }
  // Capped after the merge, not just per query: two queries of 30 each would
  // otherwise hand the routes below 60 ids and Firestore would refuse the `in`.
  // Taking the first 30 is arbitrary but bounded, and 30 site records under one
  // contact is already far past anything this business has.
  const customers = [...byId.values()].slice(0, MAX_RECORDS_PER_IDENTITY);

  if (customers.length === 0) throw new ApiError(404, PORTAL_NO_RECORDS_MESSAGE);

  return {
    uid: decoded.uid,
    identity,
    email: identity.email ?? "",
    customerIds: customers.map((c) => c.id),
    customers,
  };
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
