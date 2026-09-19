import { appendNote, getCustomer } from "@/lib/server/customerNotes";
import { audit } from "@/lib/server/audit";
import { errorResponse, requireCrew, ApiError } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { consumeRateLimit, SMS_SEND_LIMIT } from "@/lib/server/rateLimit";
import { canSendTo } from "@/lib/smsConsent";
import { isTwilioConfigured, sendSms } from "@/lib/server/twilio";

export const runtime = "nodejs";
/** Never cached — every call sends a real message. */
export const dynamic = "force-dynamic";

interface SendBody {
  customerId?: unknown;
  body?: unknown;
  /** Tags the timeline entry, e.g. "job_confirmation". Cosmetic only. */
  reason?: unknown;
}

/**
 * One-off text to a single customer.
 *
 * POST /api/sms/send
 *   Authorization: Bearer <firebase id token>
 *   { "customerId": "...", "body": "..." }
 *
 * The message is logged to that customer's notes timeline stamped with the
 * signed-in user's name, so the timeline stays a complete contact record.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request);

    const payload = (await request.json().catch(() => ({}))) as SendBody;
    const customerId = typeof payload.customerId === "string" ? payload.customerId : "";
    const body = typeof payload.body === "string" ? payload.body.trim() : "";
    const reason = typeof payload.reason === "string" ? payload.reason : "manual";

    if (!customerId) throw new ApiError(400, "customerId is required.");
    if (!body) throw new ApiError(400, "body is required.");
    if (body.length > 1600) {
      throw new ApiError(400, "Message is too long (1600 character limit).");
    }
    if (!isTwilioConfigured) {
      throw new ApiError(503, "Twilio is not configured on this deployment.");
    }

    const customer = await getCustomer(customerId);
    if (!customer) throw new ApiError(404, "Customer not found.");
    if (!customer.phone) throw new ApiError(400, "That customer has no phone number.");

    // Refused here rather than handed to Twilio, which would accept the request
    // and drop the message — leaving the timeline saying "sent" against
    // somebody who will never receive it. 409 rather than 403: the request is
    // well-formed and the caller is entitled to make it, the customer's own
    // instruction is what stands in the way.
    const verdict = canSendTo(customer);
    if (!verdict.allowed) throw new ApiError(409, verdict.reason);

    // Charged only once the request is known-good, so a typo doesn't eat the
    // caller's budget — but before Twilio is touched, which is the point.
    await consumeRateLimit(caller.uid, "sms_send", SMS_SEND_LIMIT);

    const result = await sendSms(customer.phone, body);

    if (!result.ok) {
      // Log the failure to the timeline too — "we thought we texted them" is a
      // worse failure mode at the door than a visible error.
      await appendNote(
        customerId,
        {
          text: `Text failed to send (${reason}): ${result.error}\n\n${body}`,
          kind: "sms_out",
          authorUid: caller.uid,
          authorName: caller.displayName,
        },
        { markContacted: false },
      );
      await audit({
        action: "sms.sent",
        actorUid: caller.uid,
        actorName: caller.displayName,
        target: customerId,
        ok: false,
        detail: result.error ?? "Twilio rejected the message.",
        request,
      });
      throw new ApiError(502, result.error ?? "Twilio rejected the message.");
    }

    await appendNote(customerId, {
      text: body,
      kind: "sms_out",
      authorUid: caller.uid,
      authorName: caller.displayName,
    });

    // The body is deliberately not recorded: the timeline note already holds
    // it, and the audit log is for who did what, not for a second copy of
    // every customer conversation.
    await audit({
      action: "sms.sent",
      actorUid: caller.uid,
      actorName: caller.displayName,
      target: customerId,
      ok: true,
      detail: reason,
      request,
    });

    return withCors(request, { ok: true, sid: result.sid, to: result.to });
  } catch (error) {
    return errorResponse(error, request);
  }
}

/** Preflight for the iOS shell, which calls this cross-origin. */
export function OPTIONS(request: Request): Response {
  return preflight(request);
}
