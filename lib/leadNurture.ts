/**
 * Keeping a lead warm without becoming the business that pesters people.
 *
 * A lead who never replied is the hardest case in the whole app. Doing nothing
 * loses work that was there to be won — somebody asked for a price, got busy,
 * and would still say yes if reminded. Doing too much loses the phone number:
 * texting a stranger who has never answered, six times over three months, is
 * what gets a message reported as spam, and enough reports gets an A2P 10DLC
 * campaign filtered or pulled. That is not one feature failing; it is every
 * text the business sends, including the job confirmations people actually
 * want.
 *
 * So this is deliberately short. Three touches in the first month and then
 * nothing: a nudge, something useful, and a last call. After that the lead
 * belongs to a seasonal list, because for pressure washing and gutters and
 * snow, *when* matters more than *again* — a March lead is worth a word in
 * April and October, not a "just checking in" every thirty days forever.
 *
 * Pure and import-free, so every refusal below can be tested by running it.
 * That matters more here than anywhere else in the app: this is the only code
 * that texts somebody nobody has spoken to, and every bug in it is a message
 * that cannot be recalled.
 */

/** What goes out, and how long after the lead was created. */
export const NURTURE_STEPS = [
  { day: 3, kind: "nudge" },
  { day: 10, kind: "value" },
  { day: 30, kind: "last_call" },
] as const;

export type NurtureKind = (typeof NURTURE_STEPS)[number]["kind"];

/**
 * The least time allowed between two nurture texts to one person.
 *
 * The step days are measured from when the lead was created, which means a
 * lead who has sat untouched for forty days satisfies day 3, day 10 and day 30
 * all at once. Without this, the first cron run after that would send one text,
 * the next run the second, the next the third — three messages in three days to
 * somebody who has never replied. That is the worst version of this feature,
 * and it would arrive by accident rather than by anybody choosing it.
 */
export const MIN_GAP_DAYS = 5;

/**
 * How old a lead may be for the sequence to *start* at all.
 *
 * The day this ships, the database holds every lead ever entered. Most are
 * months old and none have been through this. Starting all of them at once
 * would send a burst of "still want that estimate?" to people who asked in the
 * spring — the exact traffic pattern carriers treat as spam, on the exact day
 * the feature goes live.
 *
 * So the ladder is for leads that are actually new. Anything older is stale,
 * and a stale lead is a seasonal-list problem rather than a day-3 nudge.
 */
export const MAX_AGE_TO_START_DAYS = 45;

/** The consent methods strong enough for a marketing text. */
const MARKETING_CONSENT_METHODS = new Set(["web_form", "written"]);

export interface NurtureConsent {
  granted: boolean;
  method: string;
}

export interface NurtureInput {
  /** Where the lead sits. Only `new_lead` is nurtured — see the verdict below. */
  pipelineStage: string;
  /** The map-pin status. `do_not_knock` means leave them alone, by any channel. */
  status: string;
  createdAtMs: number;
  /** How many steps have already gone out. The index of the next one. */
  nurtureStep: number;
  lastNurtureAtMs: number | null;
  /** Has this person ever sent us anything? One reply ends the sequence. */
  hasReplied: boolean;
  phone: string;
  consent: NurtureConsent | null;
  optedOut: boolean;
}

export type NurtureVerdict =
  | { send: true; step: number; kind: NurtureKind; day: number }
  | { send: false; reason: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether to send a nurture text, which one, and if not, why not.
 *
 * Every refusal carries a reason rather than being a bare false, for the same
 * reason the review-request check does: this fires from a cron nobody watches,
 * and "nothing happened" is impossible to debug after the fact. The reasons go
 * in the run's own response so a quiet night can be explained.
 *
 * The order is the point. An opt-out is checked before anything else because it
 * outranks everything, and a reply before the schedule because a conversation
 * that has started is a person's job, not a cron's.
 */
export function nurtureDecision(input: NurtureInput, nowMs: number): NurtureVerdict {
  // Twilio blocks delivery after STOP anyway. This is here so the business
  // knows, rather than queuing messages that are dropped out of sight.
  if (input.optedOut) {
    return { send: false, reason: "this lead replied STOP" };
  }

  // One reply, ever, and the automation is done with them for good. Somebody
  // who writes back is in a conversation, and a scheduled text landing in the
  // middle of one reads as nobody being home.
  if (input.hasReplied) {
    return { send: false, reason: "this lead has replied — a person takes it from here" };
  }

  // Past `new_lead` means a quote went out, and quoted leads are chased by
  // app/api/cron/quote-followups. Nurturing them too would be two different
  // crons texting the same person about the same thing on the same day.
  if (input.pipelineStage !== "new_lead") {
    return { send: false, reason: `not a new lead any more (${input.pipelineStage})` };
  }

  if (input.status === "do_not_knock") {
    return { send: false, reason: "marked do not knock" };
  }

  if (!input.phone.trim()) {
    return { send: false, reason: "no phone number on this lead" };
  }

  // A nurture text is marketing, not transactional — it exists to win work,
  // not to service a job already agreed. That is a higher consent bar: a yes
  // spoken at a door is thin ground for a message sent a month later, where a
  // ticked box on the website or something signed is the record that supports
  // it. Leads without that are for calling and knocking, which is what the
  // business did before any of this existed.
  const consent = input.consent;
  if (!consent || !consent.granted || !MARKETING_CONSENT_METHODS.has(consent.method)) {
    return {
      send: false,
      reason: consent
        ? `consent is "${consent.method}", and marketing texts need a web form or something written`
        : "no written or web-form consent on record",
    };
  }

  // A step that is not a whole count is corrupt data, and the safe reading of
  // corrupt data is "do not text anybody". It used to be worse than unsafe: a
  // negative or fractional step indexed past the end of NURTURE_STEPS, and
  // reading `.day` off the resulting undefined threw a TypeError. One bad
  // record took the whole nightly run down with it, so nobody got nurtured at
  // all — and until this was fixed, firestore.rules guarded these counters on
  // update but not on create, which made that reachable from a client.
  if (!Number.isInteger(input.nurtureStep) || input.nurtureStep < 0) {
    return {
      send: false,
      reason: `nurtureStep is ${JSON.stringify(input.nurtureStep)}, which is not a whole count`,
    };
  }

  if (input.nurtureStep >= NURTURE_STEPS.length) {
    return { send: false, reason: "the sequence is finished — seasonal from here" };
  }

  const ageDays = (nowMs - input.createdAtMs) / DAY_MS;

  if (input.nurtureStep === 0 && ageDays > MAX_AGE_TO_START_DAYS) {
    return {
      send: false,
      reason: `too old to start a sequence (${Math.round(ageDays)} days)`,
    };
  }

  if (input.lastNurtureAtMs != null) {
    const sinceLast = (nowMs - input.lastNurtureAtMs) / DAY_MS;
    if (sinceLast < MIN_GAP_DAYS) {
      return {
        send: false,
        reason: `last message was ${Math.round(sinceLast)} days ago, minimum gap is ${MIN_GAP_DAYS}`,
      };
    }
  }

  const step = NURTURE_STEPS[input.nurtureStep];
  // Unreachable given the two checks above, and left in anyway: the cost of
  // being wrong here is a thrown TypeError inside a nightly job, which is the
  // one failure that stops every other lead being looked at.
  if (!step) {
    return { send: false, reason: `no step ${input.nurtureStep} in the sequence` };
  }
  if (ageDays < step.day) {
    return { send: false, reason: `step ${input.nurtureStep + 1} is not due until day ${step.day}` };
  }

  return { send: true, step: input.nurtureStep, kind: step.kind, day: step.day };
}

/**
 * Whether any of a lead's notes is something they sent us.
 *
 * Kept here, beside the decision that uses it, rather than in the cron: the
 * rule "an inbound message ends the sequence" is part of this policy, and a
 * caller that got the note kinds slightly wrong would silently keep texting
 * somebody who answered.
 */
export function hasInboundNote(kinds: readonly string[]): boolean {
  return kinds.some((kind) => kind === "sms_in");
}

/**
 * One lead per phone number, and the number's history applied to all of them.
 *
 * The Meta lead webhook creates a fresh customer record for every form
 * submission rather than matching an existing one, so the same person can sit
 * in the database three times. An inbound reply attaches to only one of those
 * records — findCustomerByPhone returns the first match — which means the other
 * two still look like someone who has never answered. Without this, a lead who
 * replied would keep getting nurture texts from their duplicate records, and
 * two records coming due on the same night would send two texts to one handset.
 *
 * So the number is the person, not the record. A reply or an opt-out on any
 * record counts for every record on that number, and at most one of them is
 * ever picked to send. The one picked is the furthest through the sequence,
 * because that is the record whose history is real; the duplicates behind it
 * would otherwise replay messages this person has already had.
 *
 * Pure, and keyed on a `phoneKey` the caller computes, so this file stays
 * import-free and the rule can be tested by running it.
 */
/**
 * Whether this record *could* ever send, ignoring timing.
 *
 * Only the refusals that belong to the record itself: consent, a phone
 * number, a do-not-knock mark. Not the step, not the gap, not whether
 * anything is due — those belong to the phone number and are the same for
 * every record on it.
 *
 * It exists so the grouping can prefer a record that is able to send. Picking
 * purely by progress meant an older duplicate with no consent was chosen
 * every night, refused every night, and permanently shadowed a newer
 * duplicate from the same person who *had* ticked the box on the website.
 * That lead was never nurtured at all — not a message sent wrongly, but work
 * silently left on the table, which is the failure nobody notices.
 */
export function recordIsSendable(
  record: Pick<NurtureInput, "status" | "phone" | "consent">,
): boolean {
  if (record.status === "do_not_knock") return false;
  if (!record.phone.trim()) return false;
  const consent = record.consent;
  return Boolean(consent && consent.granted && MARKETING_CONSENT_METHODS.has(consent.method));
}

export interface PhoneGroupable extends NurtureInput {
  phoneKey: string;
  /**
   * Whether this record could be sent to at all.
   *
   * An ineligible record — a duplicate that has moved on to `estimate_sent`,
   * or one with no creation date — is still part of the person's history, and
   * a reply recorded against it still means this person answered. So it votes
   * on the group and is never chosen from. Leaving these out of the grouping
   * entirely was the bug: the record carrying the reply is often exactly the
   * one that moved on, because moving it on is what somebody does *after*
   * they reply.
   */
  eligible: boolean;
}

export interface PhoneGroupResult<T> {
  /**
   * The one record allowed to send, per number, carrying the number's progress
   * rather than its own.
   *
   * The progress has to travel with it. A record's own `nurtureStep` is only
   * what *that row* has sent, and duplicates mean one person's three messages
   * can be spread across three rows — so a fresh duplicate whose sibling
   * finished the sequence would read its own 0 and start again from the top,
   * and one whose sibling texted yesterday would read its own null stamp and
   * text again today. Both of those are the thing this whole file exists to
   * prevent, arriving through the back door.
   */
  chosen: {
    lead: T;
    /** The furthest any record for this number has reached. */
    effectiveStep: number;
    /** The most recent nurture text to this number, by any record. */
    effectiveLastNurtureAtMs: number | null;
  }[];
  /** The rest, with why they were set aside. */
  setAside: { lead: T; reason: string }[];
}

export function oneLeadPerPhone<T extends PhoneGroupable>(
  leads: readonly T[],
  nowMs: number,
): PhoneGroupResult<T> {
  const byPhone = new Map<string, T[]>();
  const chosen: PhoneGroupResult<T>["chosen"] = [];
  const setAside: { lead: T; reason: string }[] = [];

  for (const lead of leads) {
    // A record with no usable number cannot be grouped and cannot be texted.
    // It is set aside rather than silently treated as its own group.
    if (!lead.phoneKey) {
      if (lead.eligible) {
        setAside.push({ lead, reason: "no usable phone number to group on" });
      }
      continue;
    }
    const group = byPhone.get(lead.phoneKey);
    if (group) group.push(lead);
    else byPhone.set(lead.phoneKey, [lead]);
  }

  for (const group of byPhone.values()) {
    // Any record saying this person replied, opted out, or asked not to be
    // contacted speaks for the number — including a record that is not itself
    // a candidate, which is usually where such a mark lives.
    const replied = group.some((lead) => lead.hasReplied);
    const optedOut = group.some((lead) => lead.optedOut);
    const blocked = group.some((lead) => lead.status === "do_not_knock");
    // Only a candidate can be sent to. The rest were context.
    const candidates = group.filter((lead) => lead.eligible);
    if (candidates.length === 0) continue;

    if (optedOut || replied || blocked) {
      const reason = optedOut
        ? "this number replied STOP on one of its records"
        : replied
          ? "this number has replied on one of its records"
          : "one of this number's records is marked do not knock";
      for (const lead of candidates) setAside.push({ lead, reason });
      continue;
    }

    // The number's progress, not the record's — every row counts towards it,
    // including the ones that are not candidates. A corrupt step is left in
    // the maximum deliberately: it then fails nurtureDecision's whole-count
    // check and the number is refused and reported, rather than a corrupt
    // sibling being quietly ignored.
    const effectiveStep = group.reduce((max, lead) => Math.max(max, lead.nurtureStep), 0);
    const stamps = group
      .map((lead) => lead.lastNurtureAtMs)
      .filter((ms): ms is number => typeof ms === "number");
    const effectiveLastNurtureAtMs = stamps.length > 0 ? Math.max(...stamps) : null;

    // Which of these records would actually send, asked of the policy itself
    // under the number's progress and the current time.
    //
    // Ranking on proxies for this was wrong twice. Sorting by progress alone
    // let an unconsented duplicate shadow a consented one; adding a
    // consent-shaped flag fixed that and left the next proxy gap behind it —
    // two equally consented step-0 records, one sixty days old and one four
    // days old, were separated by input order, and if the stale one won it
    // failed the age guard every night while the fresh lead was never
    // contacted. Both of those are the same mistake: guessing at the decision
    // instead of asking it.
    //
    // So the decision is asked. There is no third proxy to get wrong, and a
    // new refusal added to nurtureDecision is accounted for here for free.
    const verdicts = new Map<T, NurtureVerdict>();
    for (const lead of candidates) {
      verdicts.set(
        lead,
        nurtureDecision(
          { ...lead, nurtureStep: effectiveStep, lastNurtureAtMs: effectiveLastNurtureAtMs },
          nowMs,
        ),
      );
    }

    // One that would send beats one that would not. Among equals, the record
    // furthest along its own sequence, which keeps the choice stable across
    // two runs over the same data.
    const sorted = [...candidates].sort((a, b) => {
      const sendsA = verdicts.get(a)?.send === true;
      const sendsB = verdicts.get(b)?.send === true;
      if (sendsA !== sendsB) return sendsA ? -1 : 1;
      // Then one that is at least able to send, so when nothing is due the
      // reason reported is the useful one rather than a stale record's.
      const ableA = recordIsSendable(a);
      const ableB = recordIsSendable(b);
      if (ableA !== ableB) return ableA ? -1 : 1;
      return b.nurtureStep - a.nurtureStep;
    });

    chosen.push({ lead: sorted[0], effectiveStep, effectiveLastNurtureAtMs });
    for (const lead of sorted.slice(1)) {
      setAside.push({ lead, reason: "another record for this number is further along" });
    }
  }

  return { chosen, setAside };
}

/**
 * Whether a run may claim the step it decided to send, given what the database
 * actually holds right now.
 *
 * Separated from the transaction that calls it so the overlap can be tested by
 * running it. The route's version of this was a transaction on the Admin SDK,
 * which no test in this repository can reach, and "reasoned about carefully"
 * is not the same as "checked" — especially here, where the first attempt at
 * it was wrong in a way that read as correct.
 *
 * What was wrong, kept written down because it is the whole point of the
 * function: matching on `nurtureStep` alone does not stop a duplicate. The
 * counter deliberately does not advance until Twilio accepts, so between one
 * run's claim and its increment the counter still reads what the second run
 * expects. The second run matched, claimed, and sent the same text. The
 * minimum-gap rule did not save it either, because that check runs before the
 * transaction on a copy of `lastNurtureAt` read at the top of the run.
 *
 * So the claim compares both fields against what was decided on, and re-checks
 * the gap against the stored stamp. The first run's claim writes that stamp,
 * which is what the second run then trips over.
 */
export interface ClaimState {
  /** Does the document still exist? */
  exists: boolean;
  /** `nurtureStep` as stored right now. */
  freshStep: number;
  /** `lastNurtureAt` as stored right now, in ms. */
  freshLastNurtureAtMs: number | null;
  /** The step the decision was made on. */
  expectedStep: number;
  /** The stamp the decision was made on. */
  expectedLastNurtureAtMs: number | null;
}

export type ClaimVerdict = { claim: true } | { claim: false; reason: string };

export function claimVerdict(state: ClaimState, nowMs: number): ClaimVerdict {
  if (!state.exists) return { claim: false, reason: "the lead was deleted mid-run" };

  if (state.freshStep !== state.expectedStep) {
    return { claim: false, reason: `another run already advanced this lead to step ${state.freshStep}` };
  }

  // The stamp moved since this run read it: somebody else has claimed.
  if (state.freshLastNurtureAtMs !== state.expectedLastNurtureAtMs) {
    return { claim: false, reason: "another run claimed this step while this one was deciding" };
  }

  // The gap, re-checked against what is stored rather than against the copy
  // the decision was made on.
  if (state.freshLastNurtureAtMs != null) {
    const sinceLast = (nowMs - state.freshLastNurtureAtMs) / DAY_MS;
    if (sinceLast < MIN_GAP_DAYS) {
      return {
        claim: false,
        reason: `stored last message was ${Math.round(sinceLast)} days ago, minimum gap is ${MIN_GAP_DAYS}`,
      };
    }
  }

  return { claim: true };
}

/**
 * The whole authorisation for one nurture text, decided on fresh data.
 *
 * Everything above this is a filter. The cron reads the customer collection,
 * groups it, and forms an opinion — and then spends time: a per-number opt-out
 * lookup, a Firestore transaction, 1.1 seconds of pacing between sends, up to
 * ten of them. By the time the tenth text goes out, the data behind the
 * decision is minutes old, and in those minutes the lead can have replied,
 * been quoted, been marked do-not-knock, or had their consent withdrawn. The
 * first version of this re-checked only the counters, which meant all four of
 * those still permitted a send.
 *
 * So the decision that actually authorises the message is made here, from the
 * document as the transaction reads it, and the earlier one is demoted to what
 * it always was — a way to avoid doing this work for leads that obviously are
 * not due.
 *
 * Note what this cannot see: a reply recorded against a *different* record
 * for the same number during the run. That window is bounded by the length of
 * one run rather than closed, and it is the reason the per-number opt-out
 * lookup stays where it is.
 *
 * Note also what the shared document buys. Three rounds of review on this
 * feature were all the same mistake in different clothes: nurture state was
 * kept per customer record, and the thing it describes is a person. Duplicate
 * records meant every per-record guard had a per-number hole behind it. The
 * shared document is the state finally living where it belongs, which is why
 * the fix for the third concurrency finding is not a fourth guard.
 *
 * Note also what is deliberately not solved here. The marketing-consent bar —
 * a web form or something written — is enforced by this function and not by
 * the shared SMS chokepoint, which permits a verbal yes. That is on purpose:
 * `canSendTo` guards every text the business sends, job confirmations and
 * on-my-way messages included, and raising its bar to written consent would
 * block the messages customers actually want. The higher bar belongs to
 * marketing, which is this file.
 */
export interface ClaimRequest {
  /** The compare-and-swap, against the counters the decision was made on. */
  cas: ClaimState;
  /** The lead as the transaction has just read it. */
  fresh: NurtureInput;
  /** The number's progress, from the grouping pass — a snapshot, so a floor. */
  group: { effectiveStep: number; effectiveLastNurtureAtMs: number | null };
  /**
   * The phone number's own record of what it has been sent, read inside the
   * same transaction and therefore authoritative.
   *
   * This is the per-number claim. The compare-and-swap above protects one
   * customer document, which is not the invariant that matters: duplicates
   * mean two overlapping runs can select two *different* records for one
   * handset — one record changing stage between the runs is enough — and two
   * independent documents give two independent claims, so both send. The
   * shared document is what makes them collide instead.
   */
  shared: {
    step: number;
    lastNurtureAtMs: number | null;
    /**
     * A step that was handed to Twilio and whose bookkeeping never finished.
     *
     * Written by the claim, cleared when the counters are written or the send
     * is known to have failed. If it is still set, the only honest reading is
     * that a text may have gone out and the record of it may be wrong, and
     * nobody knows which.
     *
     * It blocks this number until a person clears it. The alternative is what
     * the code did before: the claim held the number for the minimum gap and
     * then, with the step counter never advanced, the same message became due
     * again — and again every five days after that, for as long as nothing
     * fixed it. For the last message in the sequence that is a stranger
     * receiving "I won't keep texting" every five days indefinitely.
     *
     * Blocking is the safe failure here. A nurture text not sent costs a
     * maybe-lead; one sent on a loop costs the number, and with it every
     * message the business actually needs to send.
     */
    pendingStep: number | null;
  };
  /**
   * The normalised number the grouping and the opt-out lookup were done
   * against, and the one the record carries now.
   *
   * They can differ. Somebody edits a lead's phone number between the read at
   * the top of the run and the claim, and every per-number check — the
   * sibling reply, the sibling opt-out, the shared progress — was done against
   * a number this record no longer has, while the send re-reads the record and
   * texts the new one. A number whose sibling said STOP could be texted that
   * way, having passed an opt-out check that looked at somebody else.
   */
  phoneKeys: { expected: string; fresh: string };
}

export type ClaimDecision =
  | { claim: true; step: number; kind: NurtureKind; day: number; phoneKey: string }
  | { claim: false; reason: string };

export function claimDecision(request: ClaimRequest, nowMs: number): ClaimDecision {
  const cas = claimVerdict(request.cas, nowMs);
  if (!cas.claim) return cas;

  // An earlier attempt reached Twilio and never finished writing down what it
  // did. Nothing automatic happens on this number again until somebody looks.
  if (request.shared.pendingStep != null) {
    return {
      claim: false,
      reason:
        `step ${request.shared.pendingStep + 1} was sent to Twilio but never recorded — ` +
        "this number is held until somebody checks whether it arrived",
    };
  }

  // The number must still be the number that was evaluated.
  if (!request.phoneKeys.fresh) {
    return { claim: false, reason: "this lead no longer has a usable phone number" };
  }
  if (request.phoneKeys.fresh !== request.phoneKeys.expected) {
    return {
      claim: false,
      reason: "this lead's phone number changed during the run — it will be reconsidered tomorrow",
    };
  }

  // Progress is the number's, and the furthest of the three readings of it
  // wins. The shared document is authoritative; the other two are floors that
  // cannot be walked backwards by a stale read.
  const effectiveStep = Math.max(
    request.group.effectiveStep,
    request.fresh.nurtureStep,
    request.shared.step,
  );
  const effectiveLastNurtureAtMs = [
    request.fresh.lastNurtureAtMs,
    request.group.effectiveLastNurtureAtMs,
    request.shared.lastNurtureAtMs,
  ].reduce<number | null>(
    (latest, ms) => (ms == null ? latest : latest == null ? ms : Math.max(latest, ms)),
    null,
  );

  const verdict = nurtureDecision(
    { ...request.fresh, nurtureStep: effectiveStep, lastNurtureAtMs: effectiveLastNurtureAtMs },
    nowMs,
  );

  if (!verdict.send) return { claim: false, reason: verdict.reason };
  return {
    claim: true,
    step: verdict.step,
    kind: verdict.kind,
    day: verdict.day,
    phoneKey: request.phoneKeys.fresh,
  };
}

/**
 * Whether a claim still owns the stamp it wrote, and may therefore undo it.
 *
 * A release must not be a blind write. The claim's stamp is its receipt: if
 * what is stored is still that exact value, nothing has happened since and
 * putting the old value back is safe. If it is anything else, another run has
 * claimed this number in the meantime and restoring the old value would erase
 * a live claim — and a number with no recent stamp is a number that gets
 * texted again inside the minimum gap.
 *
 * That was reachable, and by an ordinary route rather than a contrived one.
 * A failed send released its claim and then wrote a note explaining the
 * failure; when the note write threw, the catch released the same claim a
 * second time. Between the two releases the number was free, so an
 * overlapping run could claim it, and the second release then wiped that
 * run's stamp.
 *
 * Both halves of the fix are needed. A release happens at most once, and even
 * then only while the claim still owns what it is undoing.
 */
export function claimStillOwns(
  storedMs: number | null,
  claimedMs: number | null,
): boolean {
  if (storedMs == null || claimedMs == null) return false;
  return storedMs === claimedMs;
}
