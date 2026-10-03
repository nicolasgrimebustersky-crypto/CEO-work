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
