import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { hasInboundNote, nurtureDecision, type NurtureConsent } from "@/lib/leadNurture";
import { leadNurtureText } from "@/lib/messages";
import { adminDb } from "@/lib/server/admin";
import { ApiError, errorResponse, requireCronSecret } from "@/lib/server/auth";
import { appendNote } from "@/lib/server/customerNotes";
import { sendSmsToCustomerId } from "@/lib/server/customerSms";
import { notifyCrew } from "@/lib/server/notify";
import { isTwilioConfigured } from "@/lib/server/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Spacing between sends, so a batch does not arrive at Twilio as one burst. */
const SEND_INTERVAL_MS = 1100;

/**
 * The most nurture texts allowed in a single run.
 *
 * Not a performance limit — a safety one. If a query or a date calculation is
 * ever wrong, the damage is capped at ten messages rather than the whole
 * customer list, and the overflow is reported instead of sent. A real day's
 * work here is one or two; ten means something is wrong, and tomorrow's run can
 * finish the queue once somebody has looked at why.
 */
const MAX_SENDS_PER_RUN = 10;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Outcome {
  customerId: string;
  action: "sent" | "skipped" | "failed" | "deferred";
  step?: number;
  reason?: string;
}

/** The consent shape lib/leadNurture.ts needs, read defensively. */
function readConsent(value: unknown): NurtureConsent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.granted !== "boolean") return null;
  if (typeof raw.method !== "string") return null;
  return { granted: raw.granted, method: raw.method };
}

/** Note kinds, for the "have they ever written to us" test. */
function noteKinds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((note) =>
      note && typeof note === "object" && typeof (note as { kind?: unknown }).kind === "string"
        ? (note as { kind: string }).kind
        : "",
    )
    .filter(Boolean);
}

/**
 * Nightly lead nurture, triggered by the Vercel cron in vercel.json.
 *
 * Three texts across a lead's first month and then nothing — see
 * lib/leadNurture.ts, which owns every decision about who and when. This route
 * only reads, asks, sends and records; it holds no policy of its own, so the
 * rules can be tested without a database or a Twilio account.
 *
 * Runs on the Admin SDK and is therefore gated on CRON_SECRET rather than a
 * user token. Sends go through sendSmsToCustomerId, which refuses an opt-out
 * before Twilio is touched. The decision checks opt-out as well, and that
 * duplication is deliberate: this is the only path in the app that texts
 * somebody who has never replied, so it gets two chances to refuse.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    requireCronSecret(request);
    if (!isTwilioConfigured) {
      throw new ApiError(503, "Twilio is not configured on this deployment.");
    }

    const db = adminDb();
    // Only the one stage this feature touches. A quoted lead belongs to
    // quote-followups, and a won or lost one belongs to nobody.
    const snap = await db.collection("customers").where("pipelineStage", "==", "new_lead").get();

    const now = Date.now();
    const outcomes: Outcome[] = [];
    let sent = 0;

    for (const doc of snap.docs) {
      const data = doc.data();

      const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0;
      // A lead with no creation stamp has no measurable age, and guessing one
      // would start a sequence from an invented date. Left alone, and reported.
      if (!createdAt) {
        outcomes.push({ customerId: doc.id, action: "skipped", reason: "no createdAt" });
        continue;
      }

      const verdict = nurtureDecision(
        {
          pipelineStage: typeof data.pipelineStage === "string" ? data.pipelineStage : "",
          status: typeof data.status === "string" ? data.status : "",
          createdAtMs: createdAt,
          nurtureStep: typeof data.nurtureStep === "number" ? data.nurtureStep : 0,
          lastNurtureAtMs:
            data.lastNurtureAt instanceof Timestamp ? data.lastNurtureAt.toMillis() : null,
          hasReplied: hasInboundNote(noteKinds(data.notes)),
          phone: typeof data.phone === "string" ? data.phone : "",
          consent: readConsent(data.smsConsent),
          optedOut: Boolean(data.smsOptOut),
        },
        now,
      );

      if (!verdict.send) {
        outcomes.push({ customerId: doc.id, action: "skipped", reason: verdict.reason });
        continue;
      }

      // Everything past here would have been sent. Over the cap it is deferred
      // rather than dropped: tomorrow's run picks it up, and the count in the
      // response says how many are waiting.
      if (sent >= MAX_SENDS_PER_RUN) {
        outcomes.push({
          customerId: doc.id,
          action: "deferred",
          step: verdict.step + 1,
          reason: `run cap of ${MAX_SENDS_PER_RUN} reached`,
        });
        continue;
      }

      const firstName = typeof data.firstName === "string" ? data.firstName : "";
      const body = leadNurtureText(verdict.kind, firstName);
      const result = await sendSmsToCustomerId(doc.id, body);

      if (!result.ok) {
        // The step is NOT advanced and no stamp is written, so an unsent
        // message is retried tomorrow rather than silently spent. The note
        // records the attempt either way, because a customer record that says
        // nothing happened is how the last SMS bug stayed invisible for days.
        await appendNote(
          doc.id,
          {
            text: result.refused
              ? `Nurture step ${verdict.step + 1} not sent: ${result.error}`
              : `Nurture step ${verdict.step + 1} failed: ${result.error}`,
            kind: "sms_out",
            authorUid: "system",
            authorName: "Lead nurture",
          },
          { markContacted: false },
        );
        outcomes.push({
          customerId: doc.id,
          action: "failed",
          step: verdict.step + 1,
          reason: result.error,
        });
        continue;
      }

      await doc.ref.update({
        nurtureStep: FieldValue.increment(1),
        lastNurtureAt: FieldValue.serverTimestamp(),
      });

      await appendNote(doc.id, {
        text: body,
        kind: "sms_out",
        authorUid: "system",
        authorName: `Lead nurture ${verdict.step + 1} of 3`,
      });

      sent += 1;
      outcomes.push({ customerId: doc.id, action: "sent", step: verdict.step + 1 });
      await wait(SEND_INTERVAL_MS);
    }

    // One notification for the run, not one per lead. A nightly job that sent
    // three texts should not produce three buzzes over breakfast.
    if (sent > 0) {
      await notifyCrew({
        type: "followup_sent",
        actorName: "Lead nurture",
        body:
          sent === 1
            ? "1 quiet lead was nudged overnight."
            : `${sent} quiet leads were nudged overnight.`,
      });
    }

    return Response.json({
      ok: true,
      examined: snap.size,
      sent,
      deferred: outcomes.filter((o) => o.action === "deferred").length,
      failed: outcomes.filter((o) => o.action === "failed").length,
      outcomes,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
