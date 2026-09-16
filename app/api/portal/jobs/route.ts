import { adminDb } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { portalError, requirePortalCustomer } from "@/lib/server/portalAuth";
import { consumeRateLimit, PORTAL_READ_LIMIT } from "@/lib/server/rateLimit";
import { SERVICE_TYPES, type ServiceType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The customer's scheduled work: what, and when. Deliberately the shortest
 * shape in the app — no crew assignment, no photos, no internal notes, no
 * price (the estimate they approved already told them that). Filtered and
 * sorted here rather than in the query so no composite index has to be
 * deployed alongside this route.
 */
interface PortalJob {
  id: string;
  serviceType: ServiceType;
  status: string;
  scheduledStartMs: number | null;
  scheduledEndMs: number | null;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const millis = (value: unknown): number | null =>
  value && typeof (value as { toMillis?: unknown }).toMillis === "function"
    ? (value as { toMillis: () => number }).toMillis()
    : null;

const LOOKBACK_MS = 24 * 60 * 60 * 1000; // still show today's job after it starts

export async function GET(request: Request): Promise<Response> {
  try {
    const caller = await requirePortalCustomer(request);
    try {
      await consumeRateLimit(caller.uid, "portal_read", PORTAL_READ_LIMIT);
    } catch {
      throw new ApiError(429, "Too many requests. Please try again in a few minutes.");
    }

    const snap = await adminDb().collection("jobs").where("customerId", "in", caller.customerIds).get();
    const since = Date.now() - LOOKBACK_MS;

    const jobs: PortalJob[] = snap.docs
      .map((doc) => {
        const data = doc.data() ?? {};
        const serviceType = text(data.serviceType) as ServiceType;
        return {
          id: doc.id,
          serviceType: SERVICE_TYPES.includes(serviceType) ? serviceType : SERVICE_TYPES[0],
          status: text(data.status),
          scheduledStartMs: millis(data.scheduledStart),
          scheduledEndMs: millis(data.scheduledEnd),
        };
      })
      .filter((job) => job.status !== "cancelled" && (job.scheduledStartMs ?? 0) >= since)
      .sort((a, b) => (a.scheduledStartMs ?? 0) - (b.scheduledStartMs ?? 0));

    return withCors(request, { jobs });
  } catch (error) {
    return portalError(request, error);
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
