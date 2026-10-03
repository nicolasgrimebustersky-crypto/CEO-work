import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { phoneKey } from "@/lib/inboundSms";
import {
  claimVerdict,
  hasInboundNote,
  nurtureDecision,
  oneLeadPerPhone,
  type NurtureConsent,
} from "@/lib/leadNurture";
import { leadNurtureText } from "@/lib/messages";
import { adminDb } from "@/lib/server/admin";
import { ApiError, errorResponse, requireCronSecret } from "@/lib/server/auth";
import { appendNote, optOutForPhone } from "@/lib/server/customerNotes";
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

/** What one candidate lead looks like once its document has been read. */
interface Candidate {
  id: string;
  phoneKey: string;
  phone: string;
  firstName: string;
  pipelineStage: string;
  status: string;
  createdAtMs: number;
  nurtureStep: number;
  lastNurtureAtMs: number | null;
  hasReplied: boolean;
  consent: NurtureConsent | null;
  optedOut: boolean;
  /** Could this record be texted, or is it only here to vote on its number? */
  eligible: boolean;
}

/**
 * Claims a step before the text goes out, or declines to.
 *
 * Read-decide-send-increment is not atomic, and the gap between reading the
 * counter and writing it is a window where a second run sees the same counter
 * and sends the same message. Vercel cron delivery is at-least-once, and the
 * endpoint is reachable by anyone holding CRON_SECRET, so two runs overlapping
 * is a thing that happens rather than a thing that theoretically could.
 *
 * The claim is a compare-and-swap on BOTH fields: the transaction re-reads the
 * document and goes ahead only if `nurtureStep` and `lastNurtureAt` are still
 * exactly what the decision was made on, and only if the stored stamp is
 * outside the minimum gap.
 *
 * Checking the counter alone was not enough, and the reason is worth keeping
 * written down. `nurtureStep` deliberately does not advance until Twilio has
 * accepted, so between one run's claim and its increment the counter still
 * reads 0 — a second run arriving in that window matched on the counter,
 * claimed, and sent the same text. The minimum-gap rule did not catch it
 * either: that check runs in `nurtureDecision`, before the transaction, on the
 * copy of `lastNurtureAt` read at the top of the run. Re-reading the stamp
 * here is what closes it, because the first run's claim is itself a write to
 * that stamp.
 *
 * `nurtureStep` is still deliberately NOT incremented here. It advances only
 * after Twilio has accepted the message, which is what keeps a failed send
 * retryable. The cost is that a failure delays the retry by the minimum gap
 * instead of a day, and that is the right side to err on: a message sent twice
 * cannot be recalled, where one sent late can still be sent.
 */
async function claimStep(
  docRef: FirebaseFirestore.DocumentReference,
  expectedStep: number,
  expectedLastNurtureAtMs: number | null,
  nowMs: number,
): Promise<{ claimed: true; previous: Timestamp | null } | { claimed: false; reason: string }> {
  return adminDb().runTransaction(async (tx) => {
    const fresh = await tx.get(docRef);
    const data = fresh.exists ? (fresh.data() ?? {}) : {};
    const previous = data.lastNurtureAt instanceof Timestamp ? data.lastNurtureAt : null;

    // The decision itself lives in lib/leadNurture.ts, where it can be tested
    // by running it. This function is only the read and the write around it.
    const verdict = claimVerdict(
      {
        exists: fresh.exists,
        freshStep: typeof data.nurtureStep === "number" ? data.nurtureStep : 0,
        freshLastNurtureAtMs: previous ? previous.toMillis() : null,
        expectedStep,
        expectedLastNurtureAtMs,
      },
      nowMs,
    );

    if (!verdict.claim) return { claimed: false as const, reason: verdict.reason };

    tx.update(docRef, { lastNurtureAt: Timestamp.now() });
    return { claimed: true as const, previous };
  });
}

/**
 * Nightly lead nurture, triggered by the Vercel cron in vercel.json.
 *
 * Three texts across a lead's first month and then nothing — see
 * lib/leadNurture.ts, which owns every decision about who and when. This route
 * reads, asks, claims, sends and records; the policy lives next door so it can
 * be tested without a database or a Twilio account.
 *
 * Runs on the Admin SDK and is therefore gated on CRON_SECRET rather than a
 * user token. Three things here exist because this is the only path in the app
 * that texts somebody who has never replied, and each is worth naming:
 *
 *   The number is the person. Duplicate records for one handset are grouped,
 *   a reply or opt-out on any of them counts for all, and at most one sends.
 *
 *   The step is claimed before the send, so two overlapping runs cannot both
 *   send the same message.
 *
 *   One bad record cannot stop the run. Each lead is handled inside its own
 *   try, because a single thrown error used to abandon every lead after it.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    requireCronSecret(request);
    if (!isTwilioConfigured) {
      throw new ApiError(503, "Twilio is not configured on this deployment.");
    }

    const db = adminDb();
    // Every customer, not just the new leads.
    //
    // A filtered query was the obvious thing and it was wrong. The Meta
    // webhook creates a fresh record per form submission rather than matching
    // an existing one, so one handset can sit here several times — and the
    // record that carries the person's reply is very often the one that has
    // since moved to `estimate_sent`, because moving it on is what somebody
    // does after they reply. Querying `new_lead` alone hid exactly the records
    // that should stop the sequence, leaving the duplicates still looking like
    // somebody who had never answered.
    //
    // So the read is wide and the eligibility is narrow: every record votes on
    // its phone number, only a `new_lead` with a creation date can be sent to.
    // The cost is reading the customers collection once a night, which for a
    // business of this size is cheaper than one wrong text.
    const snap = await db.collection("customers").get();

    const now = Date.now();
    const outcomes: Outcome[] = [];

    // Read every record first. Grouping by phone needs the whole set in hand:
    // whether this record may send depends on its siblings.
    const candidates: Candidate[] = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0;
      const stage = typeof data.pipelineStage === "string" ? data.pipelineStage : "";
      // Only the one stage this feature touches. A quoted lead belongs to
      // quote-followups, and a won or lost one belongs to nobody. A lead with
      // no creation stamp has no measurable age, and guessing one would start
      // a sequence from an invented date.
      const eligible = stage === "new_lead" && createdAt > 0;

      // Worth reporting rather than passing over in silence — but only for the
      // new leads, which are the records somebody expected to be nurtured. A
      // won customer with no createdAt is not this job's business.
      if (!eligible && stage === "new_lead") {
        outcomes.push({ customerId: doc.id, action: "skipped", reason: "no createdAt" });
      }

      const phone = typeof data.phone === "string" ? data.phone : "";
      candidates.push({
        id: doc.id,
        phoneKey: phoneKey(phone),
        phone,
        firstName: typeof data.firstName === "string" ? data.firstName : "",
        pipelineStage: stage,
        status: typeof data.status === "string" ? data.status : "",
        createdAtMs: createdAt,
        nurtureStep: typeof data.nurtureStep === "number" ? data.nurtureStep : 0,
        lastNurtureAtMs:
          data.lastNurtureAt instanceof Timestamp ? data.lastNurtureAt.toMillis() : null,
        hasReplied: hasInboundNote(noteKinds(data.notes)),
        consent: readConsent(data.smsConsent),
        optedOut: Boolean(data.smsOptOut),
        eligible,
      });
    }

    const { chosen, setAside } = oneLeadPerPhone(candidates);
    for (const { lead, reason } of setAside) {
      outcomes.push({ customerId: lead.id, action: "skipped", reason });
    }

    let sent = 0;

    for (const lead of chosen) {
      // One lead's problem is one lead's problem. Before this, a single thrown
      // error — a corrupt counter was enough — ended the run and abandoned
      // every lead after it in the list.
      try {
        const verdict = nurtureDecision(lead, now);
        if (!verdict.send) {
          outcomes.push({ customerId: lead.id, action: "skipped", reason: verdict.reason });
          continue;
        }

        // Asked of the number rather than the record, because an opt-out can
        // be recorded against a duplicate this lead does not know about.
        const numberOptOut = await optOutForPhone(lead.phone);
        if (numberOptOut) {
          outcomes.push({
            customerId: lead.id,
            action: "skipped",
            reason: `this number replied ${numberOptOut.keyword || "STOP"} on another record`,
          });
          continue;
        }

        // Everything past here would have been sent. Over the cap it is
        // deferred rather than dropped: tomorrow's run picks it up, and the
        // count in the response says how many are waiting.
        if (sent >= MAX_SENDS_PER_RUN) {
          outcomes.push({
            customerId: lead.id,
            action: "deferred",
            step: verdict.step + 1,
            reason: `run cap of ${MAX_SENDS_PER_RUN} reached`,
          });
          continue;
        }

        const docRef = db.collection("customers").doc(lead.id);
        const claim = await claimStep(docRef, lead.nurtureStep, lead.lastNurtureAtMs, now);
        if (!claim.claimed) {
          outcomes.push({ customerId: lead.id, action: "skipped", reason: claim.reason });
          continue;
        }

        const body = leadNurtureText(verdict.kind, lead.firstName);
        const result = await sendSmsToCustomerId(lead.id, body);

        if (!result.ok) {
          // Put the claim back so this is retried rather than silently spent,
          // and leave nurtureStep alone — it never advanced.
          await docRef.update({ lastNurtureAt: claim.previous });
          await appendNote(
            lead.id,
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
            customerId: lead.id,
            action: "failed",
            step: verdict.step + 1,
            reason: result.error,
          });
          continue;
        }

        // Counted here, before the writes below, because the cap exists to
        // limit *texts*, and this text has already left. If the counter write
        // or the timeline note then throws, this lead is handled by the catch
        // below — but the message is out regardless, and a run that failed its
        // bookkeeping ten times must not go on to send an eleventh.
        sent += 1;

        await docRef.update({ nurtureStep: FieldValue.increment(1) });

        await appendNote(lead.id, {
          text: body,
          kind: "sms_out",
          authorUid: "system",
          authorName: `Lead nurture ${verdict.step + 1} of 3`,
        });

        outcomes.push({ customerId: lead.id, action: "sent", step: verdict.step + 1 });
        await wait(SEND_INTERVAL_MS);
      } catch (error) {
        outcomes.push({
          customerId: lead.id,
          action: "failed",
          reason: error instanceof Error ? error.message : "unexpected error",
        });
      }
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
      examined: candidates.filter((c) => c.eligible).length,
      records: snap.size,
      sent,
      deferred: outcomes.filter((o) => o.action === "deferred").length,
      failed: outcomes.filter((o) => o.action === "failed").length,
      outcomes,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
