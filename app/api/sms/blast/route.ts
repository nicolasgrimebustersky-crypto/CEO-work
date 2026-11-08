import { isAdmin } from "@/lib/auth/roles";
import { audit } from "@/lib/server/audit";
import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import {
  appendNote,
  getCustomer,
  optOutsByPhone,
  phoneSuppressionKey,
} from "@/lib/server/customerNotes";
import { consumeRateLimit, SMS_BLAST_LIMIT } from "@/lib/server/rateLimit";
import { isTwilioConfigured, sendSms } from "@/lib/server/twilio";
import { DEFAULT_ORG_ID } from "@/lib/org";
import { isQuietHour, quietHoursLabel } from "@/lib/notifications/quietHours";
import { canSendTo } from "@/lib/smsConsent";
import { marketingAllowed, recentCustomers, type ConsentMode } from "@/lib/campaigns";
import { adminDb } from "@/lib/server/admin";

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
  /**
   * A seasonal campaign (lib/campaigns.ts). Marketing gets two extra rules
   * here, on the server, whatever the screen did: only people with a
   * consent actually recorded, and never during quiet hours.
   */
  marketing?: unknown;
  /**
   * "relationship": a client with a finished job in the last 18 months may
   * get the campaign without a recorded yes. Checked here against the jobs
   * on the server, not taken from the screen. Anything else: "recorded".
   */
  consentMode?: unknown;
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
    const marketing = payload.marketing === true;
    const consentMode: ConsentMode = payload.consentMode === "relationship" ? "relationship" : "recorded";

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
    // Marketing to the customer list is the owner's call.
    if (marketing && !isAdmin(caller.email)) {
      throw new ApiError(403, "Only the owner can send a campaign.");
    }
    if (marketing && isQuietHour(new Date())) {
      throw new ApiError(409, `It's quiet hours (${quietHoursLabel()}). Send the campaign in the morning.`);
    }
    if (!isTwilioConfigured) {
      throw new ApiError(503, "Twilio is not configured on this deployment.");
    }

    // A blast is up to 200 messages, so it gets a much tighter hourly ceiling
    // than one-off texts do.
    await consumeRateLimit(caller.uid, "sms_blast", SMS_BLAST_LIMIT);

    const failed: { customerId: string; name: string; error: string }[] = [];
    let sent = 0;

    /**
     * Every STOP in the org, by number, read once before the first send.
     *
     * canSendTo alone is not enough here and never was. It reads the opt-out
     * off the single customer document whose id the client posted, while an
     * inbound STOP is written to exactly one of the several records a handset
     * can have — so every duplicate record passed the check and the message
     * went out to somebody who had asked us to stop. The screen even showed
     * the same person as blocked and as a recipient at the same time.
     *
     * One scan, not one per recipient: optOutForPhone scans the whole customer
     * collection per call, and 200 of those inside maxDuration=60 is a
     * timeout rather than a slower correct answer.
     */
    const stopped = await optOutsByPhone(DEFAULT_ORG_ID);

    // Who has bought in the last 18 months, read once, from the server's own
    // copy of the jobs: the screen's say-so is not enough to text someone.
    let recent = new Set<string>();
    if (marketing && consentMode === "relationship") {
      const snap = await adminDb().collection("jobs").where("status", "==", "complete").get();
      recent = recentCustomers(
        snap.docs.map((d) => {
          const j = d.data();
          return {
            customerId: typeof j.customerId === "string" ? j.customerId : "",
            status: "complete",
            at: typeof j.scheduledStart?.toMillis === "function" ? j.scheduledStart.toMillis() : 0,
          };
        }),
        Date.now(),
      );
    }

    /**
     * One handset, one message.
     *
     * Without this the same person receives the blast once per record they
     * have — the duplicate problem again, in its less serious direction.
     */
    const textedNumbers = new Set<string>();

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
      // Never blast someone who asked not to be contacted. A blast is where
      // this matters most: one careless selection is a hundred messages, and
      // the person who replied STOP last week is somewhere in the list.
      //
      // Asked of the NUMBER first, because that is where the instruction
      // lives. Before the rate limit is spent and before the pacing delay, so
      // 200 refusals still cannot run past maxDuration — the ordering the
      // chokepoint allowlist exists to preserve.
      const key = phoneSuppressionKey(customer.phone);
      const numberOptOut = key ? stopped.get(key) : null;
      if (numberOptOut) {
        failed.push({
          customerId,
          name,
          error: `This number replied ${numberOptOut.keyword || "STOP"} and has not opted back in. Call instead.`,
        });
        continue;
      }
      const verdict = canSendTo(customer);
      if (!verdict.allowed) {
        failed.push({ customerId, name, error: verdict.reason });
        continue;
      }
      // Not having said STOP is enough for a job reminder. For marketing it
      // takes a recorded yes, or — when the owner chose it — a finished job
      // in the last 18 months.
      if (marketing && !marketingAllowed(customer.smsConsent?.granted === true, consentMode, recent, customerId)) {
        failed.push({
          customerId,
          name,
          error:
            consentMode === "relationship"
              ? "No consent on file and no finished job in the last 18 months — not sent a marketing text."
              : "No consent to texts on file — not sent a marketing text.",
        });
        continue;
      }
      if (customer.status === "do_not_knock") {
        failed.push({ customerId, name, error: "Marked do not knock — skipped." });
        continue;
      }
      // A second record for a number already texted in this run.
      if (key && textedNumbers.has(key)) {
        failed.push({
          customerId,
          name,
          error: "Already texted on this number in this send — duplicate record.",
        });
        continue;
      }

      const result = await sendSms(customer.phone, body);
      if (result.ok) {
        sent += 1;
        if (key) textedNumbers.add(key);
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

    await audit({
      action: marketing ? "sms.campaign" : "sms.blast",
      actorUid: caller.uid,
      actorName: caller.displayName,
      ok: true,
      detail: `${sent} of ${customerIds.length} sent, ${failed.length} failed`,
      request,
    });

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
