import { codeEmail } from "@/lib/emailNotice";
import { OTP_TTL_MS, maskEmail } from "@/lib/otp";
import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { sendEmail } from "@/lib/server/email";
import { issueCode } from "@/lib/server/otp";
import { consumeRateLimit, OTP_SEND_LIMIT } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Emails a sign-in code to the account that asked for it.
 *
 * POST /api/otp/send
 *   Authorization: Bearer <firebase id token>
 *
 * One of the two routes a crew session may call before it has entered a
 * code — it has to be, or nobody could ever get one. Everything else about
 * the caller is checked as usual: a real token, an approved account. The
 * address is taken from the token, never from the body, so a code cannot be
 * sent anywhere but to the account's own mailbox.
 *
 * A failure to send is reported in Resend's own words. The likeliest one is a
 * sending domain that is not yet verified, which only delivers to the key's
 * owner — and the second crew member, who is not the owner, deserves to be
 * told that rather than "try again".
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request, { beforeCode: true });
    if (!caller.email) {
      throw new ApiError(400, "This account has no email address to send a code to.");
    }

    await consumeRateLimit(caller.uid, "otp_send", OTP_SEND_LIMIT);

    const code = await issueCode(caller.uid);
    const result = await sendEmail(
      codeEmail({ code, minutes: Math.round(OTP_TTL_MS / 60_000) }),
      { to: [caller.email] },
    );
    if (!result.sent) {
      throw new ApiError(503, `Could not email the code. ${result.problem}`.trim());
    }

    return withCors(request, { ok: true, sentTo: maskEmail(caller.email) });
  } catch (error) {
    return errorResponse(error, request);
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
