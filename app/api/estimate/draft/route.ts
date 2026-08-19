import {
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  draftProblem,
  isAllowedImageType,
} from "@/lib/estimateDraft";
import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { draftEstimate, isEstimateAIConfigured } from "@/lib/server/estimateAI";
import { consumeRateLimit, ESTIMATE_DRAFT_LIMIT } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
/** Never cached — every call is a fresh job in a driveway. */
export const dynamic = "force-dynamic";

interface DraftBody {
  description?: unknown;
  total?: unknown;
  serviceType?: unknown;
  photos?: unknown;
}

const SERVICE_TYPES = ["pressure_washing", "landscaping", "snow_removal"];

/**
 * Drafts estimate line items from a spoken description, a price and up to four
 * photos.
 *
 * POST /api/estimate/draft
 *   Authorization: Bearer <firebase id token>
 *   { "description": "...", "total": 450, "serviceType": "pressure_washing",
 *     "photos": [{ "mediaType": "image/jpeg", "data": "<base64>" }] }
 *
 * The key lives only on the server. The response is a *draft* — it lands in the
 * builder for the operator to edit, and nothing is sent to a customer from
 * here.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request);

    if (!isEstimateAIConfigured) {
      throw new ApiError(
        503,
        "ANTHROPIC_API_KEY is not set on this deployment, so estimates cannot be drafted. The builder still works by hand.",
      );
    }

    const payload = (await request.json().catch(() => ({}))) as DraftBody;
    const description = typeof payload.description === "string" ? payload.description : "";
    const total = typeof payload.total === "number" ? payload.total : Number.NaN;
    const serviceType =
      typeof payload.serviceType === "string" && SERVICE_TYPES.includes(payload.serviceType)
        ? payload.serviceType
        : "pressure_washing";

    // Photos are validated before the size check so a wrong *type* is named as
    // such rather than reported as being too big.
    const rawPhotos = Array.isArray(payload.photos) ? payload.photos : [];
    const photos = rawPhotos.slice(0, MAX_PHOTOS).map((entry) => {
      const record = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
        string,
        unknown
      >;
      const mediaType = typeof record.mediaType === "string" ? record.mediaType : "";
      const data = typeof record.data === "string" ? record.data : "";
      if (!isAllowedImageType(mediaType)) {
        throw new ApiError(400, `${mediaType || "That file"} is not an image we can read.`);
      }
      // base64 carries 3 bytes per 4 characters.
      if ((data.length * 3) / 4 > MAX_PHOTO_BYTES) {
        throw new ApiError(400, "One of those photos is too big even after shrinking.");
      }
      return { mediaType, data };
    });

    const problem = draftProblem({
      description,
      total,
      serviceType,
      photoCount: rawPhotos.length,
    });
    if (problem) throw new ApiError(400, problem);

    // Charged once the request is known-good, so a typo does not spend the
    // caller's budget — but before the model is called, which is the point.
    await consumeRateLimit(caller.uid, "estimate_draft", ESTIMATE_DRAFT_LIMIT);

    const result = await draftEstimate({ description, total, serviceType, photos });

    if (result.items.length === 0) {
      throw new ApiError(
        502,
        "Nothing usable came back. Write the lines yourself, or try describing the job differently.",
      );
    }

    return withCors(request, {
      ok: true,
      items: result.items,
      usedPhotos: result.usedPhotos,
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
