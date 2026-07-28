import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { quoteFollowUpText } from "@/lib/messages";
import { SERVICE_LABEL } from "@/lib/status";
import { adminDb } from "@/lib/server/admin";
import { ApiError, errorResponse, requireCronSecret } from "@/lib/server/auth";
import { appendNote, getCustomer } from "@/lib/server/customerNotes";
import { isTwilioConfigured, sendSms } from "@/lib/server/twilio";
import { SERVICE_TYPES, type ServiceType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Chase a silent quote every four days, three times, then give up. */
const FOLLOW_UP_INTERVAL_DAYS = 4;
const MAX_FOLLOW_UPS = 3;
const SEND_INTERVAL_MS = 1100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Outcome {
  quoteId: string;
  action: "sent" | "declined" | "skipped";
  attempt?: number;
  reason?: string;
}

/**
 * Nightly quote follow-up, triggered by the Vercel cron in vercel.json.
 *
 * A quote sitting at 'no_response' gets a text every four days, up to three
 * times, and is then marked 'declined' so it stops consuming attention. The
 * quote's own followUpCount and lastFollowUpAt are the state, so a double
 * firing on the same day cannot double-text anyone.
 *
 * Runs with the Admin SDK and is therefore gated on CRON_SECRET rather than a
 * user token.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    requireCronSecret(request);
    if (!isTwilioConfigured) {
      throw new ApiError(503, "Twilio is not configured on this deployment.");
    }

    const db = adminDb();
    const snap = await db
      .collection("quotes")
      .where("status", "==", "no_response")
      .get();

    const now = Date.now();
    const intervalMs = FOLLOW_UP_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
    const outcomes: Outcome[] = [];

    for (const quoteDoc of snap.docs) {
      const quote = quoteDoc.data();
      const followUpCount =
        typeof quote.followUpCount === "number" ? quote.followUpCount : 0;
      const customerId = typeof quote.customerId === "string" ? quote.customerId : "";
      const amount = typeof quote.amount === "number" ? quote.amount : 0;
      const serviceType = SERVICE_TYPES.includes(quote.serviceType as ServiceType)
        ? (quote.serviceType as ServiceType)
        : "pressure_washing";

      // Three attempts spent: stop chasing and record the outcome.
      if (followUpCount >= MAX_FOLLOW_UPS) {
        await quoteDoc.ref.update({ status: "declined" });
        if (customerId) {
          await appendNote(
            customerId,
            {
              text: `No reply after ${MAX_FOLLOW_UPS} follow-ups — quote marked declined.`,
              kind: "quote",
              authorUid: "system",
              authorName: "Automatic follow-up",
            },
            { markContacted: false },
          );
        }
        outcomes.push({ quoteId: quoteDoc.id, action: "declined" });
        continue;
      }

      // Wait out the interval since the last attempt (or since the quote was sent).
      const lastTouch =
        quote.lastFollowUpAt instanceof Timestamp
          ? quote.lastFollowUpAt.toMillis()
          : quote.sentAt instanceof Timestamp
            ? quote.sentAt.toMillis()
            : 0;
      if (lastTouch > 0 && now - lastTouch < intervalMs) {
        outcomes.push({ quoteId: quoteDoc.id, action: "skipped", reason: "not due yet" });
        continue;
      }

      const customer = customerId ? await getCustomer(customerId) : null;
      if (!customer || !customer.phone) {
        outcomes.push({
          quoteId: quoteDoc.id,
          action: "skipped",
          reason: "no customer phone",
        });
        continue;
      }
      if (customer.status === "do_not_knock") {
        outcomes.push({
          quoteId: quoteDoc.id,
          action: "skipped",
          reason: "do not knock",
        });
        continue;
      }

      const attempt = followUpCount + 1;
      const message = quoteFollowUpText(SERVICE_LABEL[serviceType], amount, attempt);
      const result = await sendSms(customer.phone, message);

      if (!result.ok) {
        outcomes.push({
          quoteId: quoteDoc.id,
          action: "skipped",
          reason: result.error ?? "send failed",
        });
        continue;
      }

      await quoteDoc.ref.update({
        followUpCount: FieldValue.increment(1),
        lastFollowUpAt: FieldValue.serverTimestamp(),
      });

      await appendNote(customerId, {
        text: message,
        kind: "sms_out",
        authorUid: "system",
        authorName: `Automatic follow-up ${attempt} of ${MAX_FOLLOW_UPS}`,
      });

      outcomes.push({ quoteId: quoteDoc.id, action: "sent", attempt });
      await wait(SEND_INTERVAL_MS);
    }

    return Response.json({
      ok: true,
      examined: snap.size,
      sent: outcomes.filter((o) => o.action === "sent").length,
      declined: outcomes.filter((o) => o.action === "declined").length,
      outcomes,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
