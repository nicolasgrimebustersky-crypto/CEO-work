import { lockoutEmail } from "@/lib/emailNotice";
import { digitsOnly, isCompleteCode, OTP_LENGTH } from "@/lib/otp";
import { audit } from "@/lib/server/audit";
import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { sendEmail } from "@/lib/server/email";
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
    const who = { actorUid: caller.uid, actorName: caller.displayName, request };
    switch (outcome) {
      case "wrong":
        await audit({ ...who, action: "otp.wrong", ok: false });
        throw new ApiError(400, "That code isn't right. Check the email and try again.");
      case "expired":
        await audit({ ...who, action: "otp.wrong", ok: false, detail: "expired" });
        throw new ApiError(400, "That code has expired. Send a new one.");
      case "locked":
        // Five wrong codes is somebody with the password and without the
        // mailbox. The account's owner hears about it now, from the app,
        // not later from a customer. Best effort — the refusal stands
        // whether or not the mail goes.
        await audit({ ...who, action: "otp.locked", ok: false });
        if (caller.email) {
          await sendEmail(lockoutEmail({ when: new Date().toUTCString() }), { to: [caller.email] });
        }
        throw new ApiError(400, "Too many wrong tries. Send a new code.");
      case "ok":
        break;
    }

    await markSessionVerified(caller.uid, caller.authTime);
    await audit({ ...who, action: "otp.verified", ok: true });
    return withCors(request, { ok: true });
  } catch (error) {
    return errorResponse(error, request);
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
