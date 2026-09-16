import { adminDb } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { forPortal, portalError, requirePortalCustomer } from "@/lib/server/portalAuth";
import { serializeDocument, type SerialDocument } from "@/lib/server/publicDocument";
import { consumeRateLimit, PORTAL_READ_LIMIT } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every estimate and invoice for the signed-in customer, newest first.
 *
 * Reads go through the Admin SDK scoped to the caller's customer records and
 * out through the same serializer the share-token link uses, so the portal
 * can never show a field that link would not.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const caller = await requirePortalCustomer(request);
    try {
      await consumeRateLimit(caller.uid, "portal_read", PORTAL_READ_LIMIT);
    } catch {
      throw new ApiError(429, "Too many requests. Please try again in a few minutes.");
    }

    const snap = await adminDb()
      .collection("documents")
      .where("customerId", "in", caller.customerIds)
      .get();

    const documents = snap.docs
      .map((doc) => serializeDocument(doc))
      .filter((doc): doc is SerialDocument => doc !== null)
      .map(forPortal)
      .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

    return withCors(request, { documents, customers: caller.customers });
  } catch (error) {
    return portalError(request, error);
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
