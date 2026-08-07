import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { sendPush } from "@/lib/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fans a notification out to the crew's registered devices.
 *
 * POST /api/push/send
 *   Authorization: Bearer <firebase id token>
 *   { "forUids": ["…"], "title": "…", "body": "…", "url": "/…", "tag": "…" }
 *
 * Called by the client immediately after it writes the notification record, so
 * the two halves stay together: the record is what you scroll back through, this
 * is the buzz in your pocket. The record has already been written by the time
 * this runs, which is why every failure below is reported rather than retried —
 * the event is not at risk.
 *
 * Not rate limited on purpose, unlike the SMS routes. Those spend money per
 * call and are worth capping; this one is free, and a cap on it would mean
 * dropping exactly the notification that mattered on the busiest day of the
 * year.
 */

/** Long enough for a name and an amount; short enough not to be a payload vector. */
const MAX_TEXT = 300;

function text(value: unknown, field: string, required = true): string {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (!cleaned && required) throw new ApiError(400, `${field} is required.`);
  if (cleaned.length > MAX_TEXT) throw new ApiError(400, `${field} is too long.`);
  return cleaned;
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireCrew(request);

    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const forUids = Array.isArray(payload.forUids)
      ? payload.forUids.filter((uid): uid is string => typeof uid === "string" && !!uid)
      : [];
    if (forUids.length === 0) throw new ApiError(400, "forUids is required.");

    const url = text(payload.url, "url", false) || "/dashboard";
    // Only same-origin paths. A notification that opens somewhere else is a
    // phishing primitive, and there is no legitimate reason for one here.
    if (!url.startsWith("/") || url.startsWith("//")) {
      throw new ApiError(400, "url must be a path on this site.");
    }

    const result = await sendPush({
      forUids,
      title: text(payload.title, "title"),
      body: text(payload.body, "body", false),
      url,
      tag: text(payload.tag, "tag", false) || "grime-busters",
    });

    return withCors(request, { ok: true, ...result });
  } catch (error) {
    return errorResponse(error, request);
  }
}

/** Preflight for the iOS shell, which calls this cross-origin. */
export function OPTIONS(request: Request): Response {
  return preflight(request);
}
