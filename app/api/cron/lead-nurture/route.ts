import { Timestamp } from "firebase-admin/firestore";

import { phoneKey } from "@/lib/inboundSms";
import { asOrgId, DEFAULT_ORG_ID } from "@/lib/org";
import {
  claimDecision,
  claimStillOwns,
  consumesCapacity,
  mayRelease,
  sendStateFrom,
  type SendState,
  hasInboundNote,
  nurtureDecision,
  oneLeadPerPhone,
  type NurtureConsent,
  type NurtureKind,
} from "@/lib/leadNurture";
import { leadNurtureText } from "@/lib/messages";
import { adminDb } from "@/lib/server/admin";
import { ApiError, errorResponse, requireCronSecret } from "@/lib/server/auth";
import { appendNote, numberSuppression, optOutForPhone } from "@/lib/server/customerNotes";
import { sendSmsToPhone } from "@/lib/server/customerSms";
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

/**
 * Where a phone number's nurture history lives, one document per number.
 *
 * The counters on a customer record describe that row. What this feature
 * actually needs to know is what has been sent to a *person*, and duplicate
 * records mean those are not the same thing — which is why a per-record claim
 * could be perfectly correct and still let two overlapping runs text one
 * handset twice, by selecting two different rows for it.
 *
 * Reading this document inside the claim transaction is what makes those two
 * runs collide instead: Firestore will not let both commit against the same
 * read, so the second retries, sees the first one's stamp, and refuses on the
 * gap. The customer counters are still written, because they are what the
 * timeline and the crew see on a lead.
 *
 * Admin SDK only. firestore.rules denies clients any write to it.
 */
const NUMBERS = "nurtureNumbers";

/**
 * The key for a number's nurture history.
 *
 * Scoped by org as well as by number, because a phone number is not unique
 * across businesses — a landlord, a property manager or a spouse can be a
 * customer of two companies using this app. Keying on the number alone meant
 * one business's progress, replies and do-not-knock marks held up another's
 * sequence, and one business's sends counted against a number it had never
 * texted.
 */
function numberKey(orgId: string, key: string): string {
  return `${orgId}__${key}`;
}

/**
 * Gives a claim back, so the step is retried rather than silently spent.
 *
 * Both halves of it, and the shared stamp matters more than the record's: that
 * is the one holding every record for this number back, so leaving it set
 * after a send that did not happen would delay the whole number by the
 * minimum gap for nothing. Neither step counter is touched, because neither
 * ever advanced.
 *
 * In one transaction, and only for whichever documents still carry this
 * claim's own stamp. A release used to be a blind write of the previous
 * values, which is wrong whenever anything has claimed in between: putting an
 * older stamp back over a live claim leaves a number looking untouched, and a
 * number looking untouched gets texted again inside the gap. See
 * claimStillOwns in lib/leadNurture.ts for the ordinary sequence that reached
 * it.
 *
 * Nothing is returned, because there is nothing a caller can usefully do
 * about a release it no longer owns: not finding its own stamp means somebody
 * else is holding the number, which is what the release wanted anyway.
 */
async function rollBackClaim(
  docRef: FirebaseFirestore.DocumentReference,
  claim: {
    previous: Timestamp | null;
    previousShared: Timestamp | null;
    stamp: Timestamp;
    numberRef: FirebaseFirestore.DocumentReference;
  },
): Promise<void> {
  await adminDb().runTransaction(async (tx) => {
    const [customer, shared] = await Promise.all([tx.get(docRef), tx.get(claim.numberRef)]);
    const customerStamp = customer.data()?.lastNurtureAt;
    const sharedStamp = shared.data()?.lastNurtureAt;
    const claimedMs = claim.stamp.toMillis();

    if (
      claimStillOwns(
        customerStamp instanceof Timestamp ? customerStamp.toMillis() : null,
        claimedMs,
      )
    ) {
      tx.update(docRef, { lastNurtureAt: claim.previous });
    }

    if (
      claimStillOwns(sharedStamp instanceof Timestamp ? sharedStamp.toMillis() : null, claimedMs)
    ) {
      // The pending marker goes with the claim: this attempt is known not to
      // have sent, so there is nothing unresolved to hold the number for.
      tx.set(
        claim.numberRef,
        { lastNurtureAt: claim.previousShared, pendingStep: null },
        { merge: true },
      );
    }
  });
}

interface Outcome {
  customerId: string;
  action: "sent" | "skipped" | "failed" | "deferred" | "held";
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
  orgId: string;
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
  lead: Candidate,
  group: { effectiveStep: number; effectiveLastNurtureAtMs: number | null },
  nowMs: number,
): Promise<
  | {
      claimed: true;
      previous: Timestamp | null;
      previousShared: Timestamp | null;
      step: number;
      kind: NurtureKind;
      /** The number the claim actually authorised, as read in the transaction. */
      phone: string;
      /** The stamp this claim wrote — its receipt, for an ownership-checked release. */
      stamp: Timestamp;
      numberRef: FirebaseFirestore.DocumentReference;
    }
  | { claimed: false; reason: string }
> {
  const db = adminDb();
  const numberRef = db.collection(NUMBERS).doc(numberKey(lead.orgId, lead.phoneKey));

  return db.runTransaction(async (tx) => {
    // Both documents are read inside the transaction, which puts the shared
    // one in the read set of every run that touches this number. That is the
    // whole mechanism: two runs holding two different customer records for one
    // handset now contend on this document instead of proceeding in parallel.
    const [fresh, sharedSnap] = await Promise.all([tx.get(docRef), tx.get(numberRef)]);

    const data = fresh.exists ? (fresh.data() ?? {}) : {};
    const previous = data.lastNurtureAt instanceof Timestamp ? data.lastNurtureAt : null;
    const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0;
    const phone = typeof data.phone === "string" ? data.phone : "";

    const sharedData = sharedSnap.exists ? (sharedSnap.data() ?? {}) : {};
    const previousShared =
      sharedData.lastNurtureAt instanceof Timestamp ? sharedData.lastNurtureAt : null;

    const decision = claimDecision(
      {
        cas: {
          exists: fresh.exists,
          freshStep: typeof data.nurtureStep === "number" ? data.nurtureStep : 0,
          freshLastNurtureAtMs: previous ? previous.toMillis() : null,
          expectedStep: lead.nurtureStep,
          expectedLastNurtureAtMs: lead.lastNurtureAtMs,
        },
        // Read again here rather than trusted from the top of the run: a
        // reply, a stage change, a do-not-knock mark or a withdrawn consent in
        // the meantime all land in these fields.
        fresh: {
          pipelineStage: typeof data.pipelineStage === "string" ? data.pipelineStage : "",
          status: typeof data.status === "string" ? data.status : "",
          createdAtMs: createdAt,
          nurtureStep: typeof data.nurtureStep === "number" ? data.nurtureStep : 0,
          lastNurtureAtMs: previous ? previous.toMillis() : null,
          hasReplied: hasInboundNote(noteKinds(data.notes)),
          phone,
          consent: readConsent(data.smsConsent),
          optedOut: Boolean(data.smsOptOut),
        },
        group,
        shared: {
          step: typeof sharedData.step === "number" ? sharedData.step : 0,
          lastNurtureAtMs: previousShared ? previousShared.toMillis() : null,
          pendingStep:
            typeof sharedData.pendingStep === "number" ? sharedData.pendingStep : null,
        },
        phoneKeys: { expected: lead.phoneKey, fresh: phoneKey(phone) },
      },
      nowMs,
    );

    if (!decision.claim) return { claimed: false as const, reason: decision.reason };

    const stamp = Timestamp.now();
    tx.update(docRef, { lastNurtureAt: stamp });
    // merge: the first text to a number is also the document's first write.
    // pendingStep is written before anything is handed to Twilio, so a crash
    // anywhere between here and the counter write leaves the number held
    // rather than quietly due again in five days.
    tx.set(
      numberRef,
      {
        phoneKey: decision.phoneKey,
        lastNurtureAt: stamp,
        step: decision.step,
        pendingStep: decision.step,
      },
      { merge: true },
    );

    return {
      claimed: true as const,
      previous,
      previousShared,
      step: decision.step,
      kind: decision.kind,
      phone,
      stamp,
      numberRef,
    };
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
      // Another business's lead is not this deployment's to text. The cron
      // runs on the Admin SDK, which bypasses the org checks in
      // firestore.rules entirely, so the filter the rest of the app gets for
      // free has to be written here — and without it a consented lead
      // belonging to someone else would receive Grime Busters marketing from
      // Grime Busters' own Twilio number.
      //
      // Skipped outright rather than kept as context: their replies and marks
      // are not this org's to act on, and ours are not theirs.
      if (asOrgId(data.orgId) !== DEFAULT_ORG_ID) continue;

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
        orgId: asOrgId(data.orgId),
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

    const { chosen, setAside } = oneLeadPerPhone(candidates, now);
    for (const { lead, reason } of setAside) {
      outcomes.push({ customerId: lead.id, action: "skipped", reason });
    }

    // Confirmed sends, for the report. And everything that may have reached a
    // phone, for the cap — which exists to limit messages, not successes.
    let sent = 0;
    let spent = 0;

    for (const { lead, effectiveStep, effectiveLastNurtureAtMs } of chosen) {
      // One lead's problem is one lead's problem. Before this, a single thrown
      // error — a corrupt counter was enough — ended the run and abandoned
      // every lead after it in the list.
      // Held outside the try so the catch can tell a claim that was never
      // spent from one that resulted in a text. An exception between the claim
      // and the send — hasReplyForPhone scans the whole customer collection,
      // so it can throw — used to leave both stamps written with no message
      // sent, which held the entire number back for the minimum gap for
      // nothing, and did it silently.
      let claim: Awaited<ReturnType<typeof claimStep>> | null = null;
      // Three cases, not a boolean. A send whose answer never came back is
      // neither sent nor not-sent, and calling it `texted = false` was read by
      // the catch below as nothing-happened — which gave the hold back on a
      // message that may well have arrived.
      let sendState: SendState = "none";
      // A claim is released once. The failed-send path releases and then
      // writes a note about the failure; when that note write threw, the catch
      // released the same claim again, and anything that had claimed the
      // number in between lost its stamp.
      let released = false;

      try {
        // A pre-filter only. The decision that authorises the text is made
        // from fresh data inside the claim below; this one exists so the run
        // does not pay for an opt-out lookup and a transaction on every lead
        // in the business every night. It is asked using the number's
        // progress, not this record's, or a duplicate would look overdue.
        const preview = nurtureDecision(
          { ...lead, nurtureStep: effectiveStep, lastNurtureAtMs: effectiveLastNurtureAtMs },
          now,
        );
        if (!preview.send) {
          outcomes.push({ customerId: lead.id, action: "skipped", reason: preview.reason });
          continue;
        }

        // Asked of the number rather than the record, because an opt-out can
        // be recorded against a duplicate this lead does not know about.
        const numberOptOut = await optOutForPhone(lead.phone, lead.orgId);
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
        if (spent >= MAX_SENDS_PER_RUN) {
          outcomes.push({
            customerId: lead.id,
            action: "deferred",
            step: preview.step + 1,
            reason: `run cap of ${MAX_SENDS_PER_RUN} reached`,
          });
          continue;
        }

        const docRef = db.collection("customers").doc(lead.id);
        claim = await claimStep(
          docRef,
          lead,
          { effectiveStep, effectiveLastNurtureAtMs },
          now,
        );
        if (!claim.claimed) {
          // A number held by an unresolved send is not an ordinary skip. It
          // needs somebody to check whether a text arrived, and it will stay
          // stuck until they do, so it is reported as its own thing rather
          // than sitting in a list of leads that were simply not due.
          const held = claim.reason.includes("never recorded");
          outcomes.push({
            customerId: lead.id,
            action: held ? "held" : "skipped",
            reason: claim.reason,
          });
          continue;
        }

        // The claim's step and kind, not the preview's — the claim read the
        // lead again and is the only one of the two that authorised anything.
        const step = claim.step;
        // The last per-number questions, asked after the claim rather than
        // only at the top of the run. A run works through its list for
        // minutes, and a reply, a STOP or a do-not-knock mark landing on a
        // *different* record for this handset in that window was invisible —
        // so the automation would text somebody who had just answered, or who
        // had just asked not to be contacted.
        //
        // All three in one scan. Checking only replies here was the gap: the
        // grouping caught a do-not-knock sibling at the top of the run and
        // nothing caught one that arrived during it.
        const stop = await numberSuppression(claim.phone, lead.orgId);
        const stopReason = stop.optOut
          ? `this number replied ${stop.optOut.keyword || "STOP"} during the run`
          : stop.replied
            ? "this number replied during the run — a person takes it from here"
            : stop.blocked
              ? "a record for this number was marked do not knock during the run"
              : stop.refused
                ? "a record for this number was marked no texts during the run"
                : stop.movedOn
                  ? "this number was quoted during the run — quote follow-ups have it now"
                  : null;
        if (stopReason) {
          await rollBackClaim(docRef, claim);
          released = true;
          outcomes.push({ customerId: lead.id, action: "skipped", reason: stopReason });
          continue;
        }

        const body = leadNurtureText(claim.kind, lead.firstName);
        // Sent to the number the claim validated, not to whatever the customer
        // record says by now. sendSmsToCustomerId re-read the document, so a
        // phone edit between the claim and the send meant marketing going to a
        // number whose consent, opt-out state and nurture history had never
        // been looked at. sendSmsToPhone still runs the number's own opt-out
        // check — this org's, not every org's — and the marketing-consent
        // check that authorised this belongs to the same number, because the
        // claim refused any change to it.
        const result = await sendSmsToPhone(claim.phone, body, lead.orgId);

        sendState = sendStateFrom(result);
        if (consumesCapacity(sendState)) spent += 1;

        if (!result.ok) {
          // Only a confirmed non-send gives the claim back. `ok: false` also
          // covers a request whose answer never came, where Twilio may have
          // accepted the text — releasing the hold there is how the same
          // message gets sent again five days later, which is the exact replay
          // the pending marker exists to stop.
          const certain = sendState === "none";
          if (mayRelease(sendState, released)) {
            await rollBackClaim(docRef, claim);
            released = true;
          }
          await appendNote(
            lead.id,
            {
              text: result.refused
                ? `Nurture step ${step + 1} not sent: ${result.error}`
                : certain
                  ? `Nurture step ${step + 1} failed: ${result.error}`
                  : `Nurture step ${step + 1} may have been sent — no answer from Twilio: ${result.error}. ` +
                    "This number is held until somebody checks whether it arrived.",
              kind: "sms_out",
              authorUid: "system",
              authorName: "Lead nurture",
            },
            { markContacted: false },
          );
          outcomes.push({
            customerId: lead.id,
            action: certain ? "failed" : "held",
            step: step + 1,
            reason: certain
              ? result.error
              : `no answer from Twilio, so delivery is unknown: ${result.error}`,
          });
          continue;
        }

        // Counted here, before the writes below, because the cap exists to
        // limit *texts*, and this text has already left. If the counter write
        // or the timeline note then throws, this lead is handled by the catch
        // below — but the message is out regardless, and a run that failed its
        // bookkeeping ten times must not go on to send an eleventh.
        sent += 1;

        // Set, not incremented. The step that was sent is the *number's*
        // step, which can be ahead of this record's own — a duplicate whose
        // sibling sent step 1 sends step 2 from its own counter of 0, and
        // incrementing would leave it at 1 and send step 2 again tomorrow.
        //
        // The number's own document is advanced too, and it is the one that
        // will still be right tomorrow if this record is edited, re-staged or
        // deleted in the meantime.
        // The number's document first, and in one write, because advancing
        // the step and clearing the pending marker have to happen together.
        // If this throws, pendingStep stays set and the number is held for a
        // person to look at — which is the whole point of it. If it succeeds
        // and the customer write below throws, progress is still correct,
        // because this document is the authoritative one.
        await claim.numberRef.set({ step: step + 1, pendingStep: null }, { merge: true });
        await docRef.update({ nurtureStep: step + 1 });

        await appendNote(lead.id, {
          text: body,
          kind: "sms_out",
          authorUid: "system",
          authorName: `Lead nurture ${step + 1} of 3`,
        });

        outcomes.push({ customerId: lead.id, action: "sent", step: step + 1 });
        await wait(SEND_INTERVAL_MS);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unexpected error";

        // A claim that never became a text is given back. Leaving it would
        // block every record for this number for the minimum gap over a
        // failure that sent nothing — the opposite of what the claim is for.
        // Only a claim known to have sent nothing. An uncertain send keeps its
        // hold through the exception — that is the whole reason sendState has
        // three cases instead of two.
        // Set when the release itself failed, which leaves the claim — and
        // with it pendingStep — standing. That is not a delay, it is a stop:
        // no later run clears a pending marker, so this number waits for a
        // person. It said "waits five days" until this was corrected, which
        // was true of the claim's stamp alone and stopped being true the
        // moment the pending marker was added.
        let stuck = false;

        if (claim?.claimed && mayRelease(sendState, released)) {
          try {
            await rollBackClaim(db.collection("customers").doc(lead.id), claim);
            released = true;
          } catch {
            stuck = true;
          }
        }

        // On the timeline too, because a lead that silently failed to be
        // nurtured looks exactly like one that was never due.
        try {
          await appendNote(
            lead.id,
            {
              text: stuck
                ? `Nurture attempt failed before sending: ${reason}. Releasing the hold also ` +
                  "failed, so this number is held and no later run will clear it — it needs " +
                  "clearing by hand."
                : sendState === "sent"
                  ? `Nurture text sent, but recording it failed: ${reason}`
                  : sendState === "unknown"
                    ? `Nurture text may have been sent — no answer from Twilio — and recording it failed: ${reason}. ` +
                      "This number is held until somebody checks whether it arrived."
                    : `Nurture attempt failed before sending: ${reason}`,
              kind: "sms_out",
              authorUid: "system",
              authorName: "Lead nurture",
            },
            { markContacted: false },
          );
        } catch {
          // Nothing more to do here. The outcome below is the record.
        }

        outcomes.push({
          customerId: lead.id,
          // Held, not failed, whenever a hold is left standing — whether
          // because the send was uncertain or because releasing it failed.
          // Both need a person, and only "held" reaches the notification.
          action: stuck || sendState !== "none" ? "held" : "failed",
          reason: stuck
            ? `${reason} — and the hold could not be released, so this number is stuck until somebody clears it`
            : reason,
        });
      }
    }

    // One notification for the run, not one per lead. A nightly job that sent
    // three texts should not produce three buzzes over breakfast.
    const held = outcomes.filter((o) => o.action === "held");

    // One notification for the run. Not one per lead, and not one per kind of
    // outcome either — a run that nudged three leads and held one used to
    // send two, which is both the thing the comment here promised not to do
    // and two buzzes over breakfast instead of one.
    //
    // The held count leads, because it is the part that needs somebody.
    if (sent > 0 || held.length > 0) {
      const nudged =
        sent === 1 ? "1 quiet lead was nudged overnight" : `${sent} quiet leads were nudged overnight`;
      const blocked =
        held.length === 1
          ? "1 lead is held and needs a person: a text may have gone out without being recorded"
          : `${held.length} leads are held and need a person: texts may have gone out without being recorded`;

      await notifyCrew({
        type: "followup_sent",
        actorName: "Lead nurture",
        body:
          held.length === 0
            ? `${nudged}.`
            : sent === 0
              ? `${blocked}. Check whether ${held.length === 1 ? "it" : "they"} arrived.`
              : `${nudged}, and ${blocked}. Check whether ${held.length === 1 ? "it" : "they"} arrived.`,
      });
    }

    return Response.json({
      ok: true,
      examined: candidates.filter((c) => c.eligible).length,
      records: snap.size,
      sent,
      deferred: outcomes.filter((o) => o.action === "deferred").length,
      held: held.length,
      failed: outcomes.filter((o) => o.action === "failed").length,
      outcomes,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
