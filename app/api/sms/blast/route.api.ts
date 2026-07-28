import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { appendNote, getCustomer } from "@/lib/server/customerNotes";
import { consumeRateLimit, SMS_BLAST_LIMIT } from "@/lib/server/rateLimit";
import { isTwilioConfigured, sendSms } from "@/lib/server/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Blasts can take a while; Twilio calls are sequential and rate-limited. */
export const maxDuration = 60;

/** Guard rail against a mis-filtered blast to the entire customer list. */
const MAX_RECIPIENTS = 200;
/** Twilio's default per-account send rate is 1 message/second. */
const SEND_INTERVAL_MS = 1100;

interface BlastBody {
  customerIds?: unknown;
  body?: unknown;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends the same message to a filtered group — every "quoted" lead, everyone in
 * a zip code, and so on. The client does the filtering (it already holds the
 * whole customer list in a realtime listener) and posts the resulting ids here,
 * so the filter UI and the map/list filters stay one implementation.
 *
 * POST /api/sms/blast
 *   Authorization: Bearer <firebase id token>
 *   { "customerIds": ["...", "..."], "body": "..." }
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request);

    const payload = (await request.json().catch(() => ({}))) as BlastBody;
    const customerIds = Array.isArray(payload.customerIds)
      ? payload.customerIds.filter((id): id is string => typeof id === "string")
      : [];
    const body = typeof payload.body === "string" ? payload.body.trim() : "";

    if (customerIds.length === 0) throw new ApiError(400, "No recipients selected.");
    if (!body) throw new ApiError(400, "Message body is required.");
    if (body.length > 1600) {
      throw new ApiError(400, "Message is too long (1600 character limit).");
    }
    if (customerIds.length > MAX_RECIPIENTS) {
      throw new ApiError(
        400,
        `That's ${customerIds.length} recipients, over the ${MAX_RECIPIENTS} limit. Narrow the filter first.`,
      );
    }
    if (!isTwilioConfigured) {
      throw new ApiError(503, "Twilio is not configured on this deployment.");
    }

    // A blast is up to 200 messages, so it gets a much tighter hourly ceiling
    // than one-off texts do.
    await consumeRateLimit(caller.uid, "sms_blast", SMS_BLAST_LIMIT);

    const failed: { customerId: string; name: string; error: string }[] = [];
    let sent = 0;

    // Sequential on purpose: firing 200 concurrent requests trips Twilio's rate
    // limit and the failures come back as opaque 429s.
    for (const [index, customerId] of customerIds.entries()) {
      const customer = await getCustomer(customerId);
      const name = customer
        ? `${customer.firstName} ${customer.lastName}`.trim() || customer.address
        : customerId;

      if (!customer) {
        failed.push({ customerId, name, error: "Customer not found." });
        continue;
      }
      if (!customer.phone) {
        failed.push({ customerId, name, error: "No phone number." });
        continue;
      }
      // Never blast someone who asked not to be contacted.
      if (customer.status === "do_not_knock") {
        failed.push({ customerId, name, error: "Marked do not knock — skipped." });
        continue;
      }

      const result = await sendSms(customer.phone, body);
      if (result.ok) {
        sent += 1;
        await appendNote(customerId, {
          text: body,
          kind: "sms_out",
          authorUid: caller.uid,
          authorName: caller.displayName,
        });
      } else {
        failed.push({ customerId, name, error: result.error ?? "Send failed." });
      }

      if (index < customerIds.length - 1) await wait(SEND_INTERVAL_MS);
    }

    return withCors(request, {
      ok: true,
      attempted: customerIds.length,
      sent,
      failed,
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}

/** Preflight for the iOS shell, which calls this cross-origin. */
export function OPTIONS(request: Request): Response {
  return preflight(request);
}
