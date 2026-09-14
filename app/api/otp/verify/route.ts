import { digitsOnly, isCompleteCode, OTP_LENGTH } from "@/lib/otp";
import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { checkCode, markSessionVerified } from "@/lib/server/otp";
import { consumeRateLimit, OTP_VERIFY_LIMIT } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Checks a sign-in code and, if it is right, records this sign-in as passed.
 *
 * POST /api/otp/verify
 *   Authorization: Bearer <firebase id token>
 *   { "code": "204815" }
 *
 * The other route a not-yet-verified session may call. On success the
 * session's auth_time is added to the account's claim; the client then asks
 * Firebase for a fresh token and the rules start saying yes. Nothing about
 * "verified" is returned to the client because nothing about it is the
 * client's to hold — the token is the proof.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request, { beforeCode: true });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "That did not arrive properly. Try again.");
    }
    const code = digitsOnly((body as { code?: unknown })?.code);
    if (!isCompleteCode(code)) {
      throw new ApiError(400, `Enter all six digits — the code is ${OTP_LENGTH} numbers long.`);
    }

    await consumeRateLimit(caller.uid, "otp_verify", OTP_VERIFY_LIMIT);

    const outcome = await checkCode(caller.uid, code);
    switch (outcome) {
      case "wrong":
        throw new ApiError(400, "That code isn't right. Check the email and try again.");
      case "expired":
        throw new ApiError(400, "That code has expired. Send a new one.");
      case "locked":
        throw new ApiError(400, "Too many wrong tries. Send a new code.");
      case "ok":
        break;
    }

    await markSessionVerified(caller.uid, caller.authTime);
    return withCors(request, { ok: true });
  } catch (error) {
    return errorResponse(error, request);
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
