import { adminDb } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { forPortal, portalError, requirePortalCustomer, type PortalCaller } from "@/lib/server/portalAuth";
import { serializeDocument, type SerialDocument } from "@/lib/server/publicDocument";
import { respondToDocument } from "@/lib/server/quoteRespond";
import { consumeRateLimit, PORTAL_READ_LIMIT, PORTAL_RESPOND_LIMIT } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NOT_FOUND = "We couldn't find that document.";

/**
 * One document, only if it belongs to the signed-in customer. A document that
 * exists but is somebody else's gets the same answer as one that does not
 * exist, so the portal never confirms which ids are real.
 */
async function ownDocument(caller: PortalCaller, id: string): Promise<SerialDocument> {
  const clean = id.trim();
  if (!clean || clean.length > 128) throw new ApiError(404, NOT_FOUND);
  const snap = await adminDb().collection("documents").doc(clean).get();
  const document = serializeDocument(snap);
  if (!document || !caller.customerIds.includes(document.customerId)) {
    throw new ApiError(404, NOT_FOUND);
  }
  return document;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const caller = await requirePortalCustomer(request);
    try {
      await consumeRateLimit(caller.uid, "portal_read", PORTAL_READ_LIMIT);
    } catch {
      throw new ApiError(429, "Too many requests. Please try again in a few minutes.");
    }
    const { id } = await params;
    const document = await ownDocument(caller, id);
    const customer = caller.customers.find((c) => c.id === document.customerId) ?? null;
    return withCors(request, { document: forPortal(document), customer });
  } catch (error) {
    return portalError(request, error);
  }
}

/** Approve (sign, pick a date) or decline an estimate, exactly as the texted link does. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const caller = await requirePortalCustomer(request);
    try {
      await consumeRateLimit(caller.uid, "portal_respond", PORTAL_RESPOND_LIMIT);
    } catch {
      throw new ApiError(429, "Too many attempts. Please try again in a few minutes.");
    }
    const { id } = await params;
    const document = await ownDocument(caller, id);
    const result = await respondToDocument(document, request, { uid: caller.uid });
    return withCors(request, result.body, { status: result.status });
  } catch (error) {
    return portalError(request, error);
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
