/**
 * Automations the owner builds himself.
 *
 * `lib/leadNurture.ts` is one sequence, reasoned about line by line and tuned
 * for one situation: an estimate nobody answered. This module is the general
 * case — a trigger, some filters, a message, and the rules about when it may
 * fire — so a new follow-up can be designed in the app instead of in a pull
 * request.
 *
 * That is a genuinely more dangerous thing to ship, and the danger is worth
 * naming. A sequence written in code gets read by somebody before it reaches a
 * phone. One built in a form does not. The person building it is thinking
 * about the customer he wants to win back, not about A2P 10DLC registration,
 * carrier spam thresholds, or the fact that the database holds four years of
 * estimates and "30 days after the estimate" is true of nearly all of them at
 * once.
 *
 * So the design rule here is that the builder cannot express an unsafe
 * automation. Not "should not" — cannot. Every number the form collects goes
 * through `clampGuards` before it is stored and again before it is run, and
 * the ceilings in this file are lower than anything a person would type by
 * accident. The worst automation that can be built is still a slow one.
 *
 * Three of these ceilings exist because `lib/leadNurture.ts` learned them the
 * hard way, and the comments there are worth reading:
 *
 *   - a floor under the gap between two texts to one person, because step days
 *     measured from an anchor all come due at once on an old record;
 *   - a cap on how old an anchor may be for a sequence to *start*, because the
 *     day a sequence goes live every historical record qualifies;
 *   - a cap per run, so a wrong date calculation costs a handful of texts
 *     rather than the customer list.
 *
 * Pure and import-free at runtime: the imports below are all `import type`, so
 * nothing here loads a database, a clock or a network. Every refusal in
 * `decide` can be tested by calling it.
 */

import { BUSINESS_TIMEZONE, hourInBusinessTimezone } from "@/lib/notifications/quietHours";
import type { PipelineStage } from "./pipeline";
import type { PropertyType, ServiceType } from "./types";

/**
 * What an automation can watch for.
 *
 * Each trigger names a date on a record — the anchor — and the automation
 * fires a chosen number of days after it. Keeping the shape that narrow is
 * what makes the whole thing explainable in one sentence on screen: "N days
 * after X, do Y."
 */
export const AUTOMATION_TRIGGERS = [
  /** An estimate was sent and nobody has accepted or declined it. */
  "estimate_unanswered",
  /** An invoice is past its due date and still owes money. */
  "invoice_overdue",
  /** A job was finished. For review asks and re-book nudges. */
  "job_finished",
  /** A lead has sat in the same pipeline stage, untouched. */
  "lead_idle",
  /** Nothing at all has happened on a customer — the seasonal win-back. */
  "customer_quiet",
] as const;

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  estimate_unanswered: "An estimate goes unanswered",
  invoice_overdue: "An invoice goes past due",
  job_finished: "A job is finished",
  lead_idle: "A lead goes quiet in one stage",
  customer_quiet: "A past customer hasn't been heard from",
};

/** What the screen says the day count is measured from. */
export const TRIGGER_ANCHOR_LABEL: Record<AutomationTrigger, string> = {
  estimate_unanswered: "the estimate was sent",
  invoice_overdue: "the invoice fell due",
  job_finished: "the job was finished",
  lead_idle: "they last moved stage or were contacted",
  customer_quiet: "anything last happened on the record",
};

export const AUTOMATION_ACTIONS = [
  /** Text the customer. The one that reaches a real person. */
  "send_sms",
  /** Tell the crew, through the notification system. Nothing leaves the app. */
  "notify_crew",
  /** Write a line on the customer's timeline. */
  "add_note",
  /** Move the lead to another pipeline stage. */
  "move_stage",
] as const;

export type AutomationActionKind = (typeof AUTOMATION_ACTIONS)[number];

export const ACTION_LABEL: Record<AutomationActionKind, string> = {
  send_sms: "Text the customer",
  notify_crew: "Notify me in the app",
  add_note: "Add a note to their timeline",
  move_stage: "Move them to another stage",
};

/** True for the actions that reach somebody outside the business. */
export function actionLeavesTheBuilding(kind: AutomationActionKind): boolean {
  return kind === "send_sms";
}

// ---------------------------------------------------------------------------
// The ceilings
// ---------------------------------------------------------------------------

/**
 * The least days allowed between two automated texts to one person.
 *
 * `lib/leadNurture.ts` uses five for its own ladder. Three is the floor here
 * because a custom automation may legitimately be a tighter sequence than the
 * estimate one — a two-day "did you get my voicemail" is a reasonable thing to
 * want — but below three the same person starts getting a text every other
 * day, which is the pattern that gets a number reported rather than answered.
 */
export const MIN_GAP_DAYS_FLOOR = 3;

/**
 * The most texts one automation may ever send to one person.
 *
 * Four, matching the reasoning in `lib/leadNurture.ts`: three touches and a
 * last call is the point where a sequence has either worked or annoyed
 * somebody. An automation that wants a fifth is a different automation, and
 * making that a deliberate act is the point.
 */
export const MAX_TOUCHES_CEILING = 4;

/**
 * The most sends one automation may make in a single run.
 *
 * Not a performance limit. If a date calculation or a filter is wrong, this is
 * the blast radius. Twenty-five is large enough for a real seasonal push on a
 * list this size and small enough to notice and stop by hand the next morning.
 */
export const MAX_PER_RUN_CEILING = 25;

/**
 * The most sends all automations together may make in one run.
 *
 * Six automations each capped at twenty-five is a hundred and fifty texts from
 * one cron run, which is the thing the per-automation cap was supposed to
 * prevent. The run-wide cap is what actually bounds a bad morning.
 */
export const MAX_PER_RUN_ALL = 40;

/**
 * How wide the net may be - the most days between "due" and "too old".
 *
 * This is the ceiling that matters most, and the one whose absence would do
 * the most damage. The day an automation is switched on, every record that has
 * ever satisfied its trigger satisfies it right now: "14 days after the
 * estimate was sent" is true of an estimate from last spring. Without a cap
 * the first run after arming reaches years back at once, which is both the
 * worst customer experience the app can produce and the exact traffic shape
 * carriers treat as spam.
 *
 * It bounds the WIDTH of the window rather than an absolute age, and that
 * correction came from a test. An absolute cap of 120 days looked right until
 * clampGuards was asked for a 365-day wait: the stale value has to leave room
 * for the trigger to fire at all, so the floor rose above the ceiling and the
 * ceiling quietly stopped applying. An absolute number is the wrong measure
 * anyway - at a 3-day wait it allows a 117-day net, and at a 90-day wait only
 * 30. What is dangerous is how many records the net holds, which is its width.
 *
 * Measuring the width also allows the automation this business genuinely wants
 * and an absolute cap forbade: a word a year after a gutter clean, with a net
 * no wider than four months around it.
 *
 * Anything older is somebody's decision to make by hand, from the blast
 * screen, where the recipient list is on screen before anything sends.
 */
export const MAX_WINDOW_DAYS = 120;

/**
 * The earliest and latest local hour an automated text may be sent.
 *
 * The TCPA's quiet-hours rule is 8pm to 8am in the recipient's local time, and
 * the penalty for getting it wrong is per message. This window is narrower at
 * both ends than the law requires, because the law is the line past which it
 * is illegal, not the line past which it is a good idea: a 7:58pm "about your
 * estimate" is legal and still reads as pestering.
 */
export const SEND_HOUR_FLOOR = 8;
export const SEND_HOUR_CEILING = 19;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * Who an automation is allowed to touch, beyond what the trigger already says.
 *
 * Every list is "empty means any". That default is deliberate: a half-filled
 * form should widen to everybody the trigger found, never silently narrow to
 * nobody, because an automation that matches nobody looks identical to one
 * that is working and has nothing to do.
 */
export interface AutomationConditions {
  minAmount: number | null;
  maxAmount: number | null;
  serviceTypes: ServiceType[];
  stages: PipelineStage[];
  propertyTypes: PropertyType[];
  /**
   * Text that must appear somewhere in the customer's address.
   *
   * Not a city, because there is no city field: `Customer` stores one
   * `address` string. A name promising city equality, matched with `==`
   * against a whole address, would have matched nobody at all — which is the
   * failure that looks exactly like an automation quietly working. A
   * substring is what the data supports, so a substring is what it is called.
   */
  addressContains: string[];
}

export interface AutomationAction {
  kind: AutomationActionKind;
  /**
   * The message, for `send_sms` and `add_note`. Merge fields in braces, see
   * `TEMPLATE_FIELDS`. The opt-out sentence is appended by
   * `automationSmsText`, not stored here, so it cannot be edited away.
   */
  body: string;
  /** Where `move_stage` moves them. Ignored by every other action. */
  stage: PipelineStage | null;
}

/**
 * The numbers that decide when an automation may fire.
 *
 * Stored already clamped, and clamped again on the way into `decide`. Storing
 * the clamped values means the form shows the owner the number that will
 * actually be used rather than the one he typed, and re-clamping on read means
 * a document edited by hand, or written before a ceiling was lowered, still
 * cannot exceed today's limits.
 */
export interface AutomationGuards {
  /** Days after the anchor before the first send. */
  afterDays: number;
  /** Days before the same person may be touched again. `null` means never. */
  repeatEveryDays: number | null;
  maxTouches: number;
  minGapDays: number;
  maxPerRun: number;
  /** Anchors older than this are left alone. See MAX_WINDOW_DAYS. */
  staleAfterDays: number;
  startHour: number;
  endHour: number;
  /** Local days of week it may send on. 0 is Sunday. Empty means any. */
  daysOfWeek: number[];
  /** A reply from the customer ends the sequence. Forced on for texts. */
  stopOnReply: boolean;
}

/**
 * The flattened view of a customer the engine reasons about.
 *
 * Assembled by the server from whatever records the trigger needed, so this
 * module never learns what a Firestore document looks like. `touches` and
 * `lastTouchAt` describe what *this automation* has already done to *this
 * phone number* — not this record, which is the distinction that the
 * duplicate-record bug in the blast screen was about.
 */
export interface AutomationSubject {
  customerId: string;
  firstName: string | null;
  phone: string | null;
  address: string | null;
  propertyType: PropertyType | null;
  stage: PipelineStage | null;
  serviceType: ServiceType | null;
  /** The date the trigger measures from, ISO. */
  anchorAt: string | null;
  /** The money on the triggering record, if it has any. */
  amount: number | null;
  touches: number;
  lastTouchAt: string | null;
  /** Has the customer said anything since the anchor? */
  repliedSince: boolean;
}

export interface Automation {
  id: string;
  orgId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationConditions;
  action: AutomationAction;
  guards: AutomationGuards;
}

/** The run's instant, already resolved into the business's local time. */
export interface AutomationClock {
  at: string;
  localHour: number;
  /** 0 is Sunday. */
  localDay: number;
}

/**
 * Resolves an instant into the business's local hour and weekday.
 *
 * The hour comes from `hourInBusinessTimezone`, which already exists for push
 * quiet hours and already carries the "24 for midnight" quirk and the reason
 * the timezone has to be named explicitly on a server running in UTC. Two
 * copies of that reasoning would drift, and the one that drifted would be the
 * one that texts people.
 *
 * Daylight saving is the reason this goes through `Intl` at all rather than a
 * fixed offset: the sending window would otherwise slide an hour twice a year
 * and start texting people at seven in the morning every November.
 */
export function clockFrom(at: Date, timeZone: string = BUSINESS_TIMEZONE): AutomationClock {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(at);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    at: at.toISOString(),
    localHour: hourInBusinessTimezone(at, timeZone),
    localDay: Math.max(0, days.indexOf(weekday)),
  };
}

// ---------------------------------------------------------------------------
// Clamping
// ---------------------------------------------------------------------------

function clampInt(value: unknown, low: number, high: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(high, Math.max(low, Math.round(number)));
}

/**
 * Forces a set of guards inside every ceiling in this file.
 *
 * Total, not validating: it always returns a usable set rather than failing,
 * because it runs on the way *out* of the database as well as in, where
 * refusing would mean an automation that cannot be read is an automation that
 * cannot be switched off.
 */
export function clampGuards(raw: Partial<AutomationGuards> | null | undefined): AutomationGuards {
  const guards = raw ?? {};

  const afterDays = clampInt(guards.afterDays, 1, 365, 3);
  const minGapDays = clampInt(guards.minGapDays, MIN_GAP_DAYS_FLOOR, 90, MIN_GAP_DAYS_FLOOR);

  // A repeat closer together than the minimum gap is the same instruction
  // twice, and the stricter one has to win or the gap is decorative.
  const rawRepeat = guards.repeatEveryDays;
  const repeatEveryDays =
    rawRepeat === null || rawRepeat === undefined
      ? null
      : Math.max(minGapDays, clampInt(rawRepeat, 1, 365, minGapDays));

  // The window runs from the day it comes due to the day it is too old, so
  // both ends are relative to afterDays. The floor has to leave room for the
  // trigger to fire - an automation that waits 14 days and ignores anything
  // older than 7 can never send, and on screen that is indistinguishable from
  // one that is armed and simply has nothing to do today.
  const staleAfterDays = clampInt(
    guards.staleAfterDays,
    afterDays + 1,
    afterDays + MAX_WINDOW_DAYS,
    afterDays + 30,
  );

  const startHour = clampInt(guards.startHour, SEND_HOUR_FLOOR, SEND_HOUR_CEILING, 9);
  const endHour = Math.max(
    startHour + 1,
    clampInt(guards.endHour, SEND_HOUR_FLOOR + 1, SEND_HOUR_CEILING, 17),
  );

  const daysOfWeek = Array.isArray(guards.daysOfWeek)
    ? [...new Set(guards.daysOfWeek.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : [];

  return {
    afterDays,
    repeatEveryDays,
    maxTouches: clampInt(guards.maxTouches, 1, MAX_TOUCHES_CEILING, 1),
    minGapDays,
    maxPerRun: clampInt(guards.maxPerRun, 1, MAX_PER_RUN_CEILING, 10),
    staleAfterDays,
    startHour,
    endHour: Math.min(endHour, SEND_HOUR_CEILING),
    daysOfWeek,
    stopOnReply: guards.stopOnReply !== false,
  };
}

/** The guards a brand-new automation starts with: cautious, and editable. */
export function defaultGuards(): AutomationGuards {
  return clampGuards({
    afterDays: 3,
    repeatEveryDays: null,
    maxTouches: 1,
    minGapDays: MIN_GAP_DAYS_FLOOR,
    maxPerRun: 10,
    staleAfterDays: 33,
    startHour: 9,
    endHour: 17,
    daysOfWeek: [],
    stopOnReply: true,
  });
}

export function defaultConditions(): AutomationConditions {
  return {
    minAmount: null,
    maxAmount: null,
    serviceTypes: [],
    stages: [],
    propertyTypes: [],
    addressContains: [],
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * The merge fields a message may use.
 *
 * Short on purpose. Every field here is something the server can always fill
 * from the records the trigger already loaded; anything that might be missing
 * renders as empty rather than as the word "undefined" in a stranger's text
 * message, which is the failure this list exists to prevent.
 */
export const TEMPLATE_FIELDS = [
  { token: "first_name", label: "Their first name", example: "Dana" },
  { token: "business", label: "Your business name", example: "Grime Busters" },
  { token: "amount", label: "The amount on the estimate or invoice", example: "$450" },
  { token: "owner_phone", label: "Your phone number", example: "502-599-6855" },
] as const;

export type TemplateToken = (typeof TEMPLATE_FIELDS)[number]["token"];

export type TemplateVars = Partial<Record<TemplateToken, string>>;

/**
 * Fills `{first_name}` and friends.
 *
 * An unknown token is left exactly as typed rather than blanked. A stray brace
 * in a message is a typo the owner can see and fix in the preview; silently
 * deleting the words around it would hide the mistake until a customer read
 * the result.
 */
export function renderTemplate(body: string, vars: TemplateVars): string {
  const known = new Set(TEMPLATE_FIELDS.map((field) => field.token as string));
  return String(body ?? "").replace(/\{(\w+)\}/g, (whole, token: string) => {
    if (!known.has(token)) return whole;
    return vars[token as TemplateToken] ?? "";
  });
}

/** Tokens in a body that are not merge fields, for the builder to warn about. */
export function unknownTokens(body: string): string[] {
  const known = new Set(TEMPLATE_FIELDS.map((field) => field.token as string));
  const found = String(body ?? "").match(/\{(\w+)\}/g) ?? [];
  return [...new Set(found.map((match) => match.slice(1, -1)).filter((token) => !known.has(token)))];
}

/**
 * What the message will cost to send, in SMS segments.
 *
 * Shown in the builder because the number is the difference between a decision
 * and a surprise: three segments to forty people is a hundred and twenty
 * messages on the bill, and the only place anybody will ever notice is here.
 */
export function segmentsFor(text: string): number {
  const length = String(text ?? "").length;
  if (length === 0) return 0;
  // GSM-7 single message is 160; concatenated parts carry a 6-byte header.
  return length <= 160 ? 1 : Math.ceil(length / 153);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function addressHas(address: string | null, needle: string): boolean {
  const trimmed = needle.trim().toLowerCase();
  // An empty entry must not match everything: a stray blank row in the
  // builder would otherwise widen the automation to the whole list.
  if (trimmed === "") return false;
  return address !== null && address.toLowerCase().includes(trimmed);
}

/** Whether a subject passes the automation's filters. Empty list means any. */
export function matchesConditions(
  subject: AutomationSubject,
  conditions: AutomationConditions,
): boolean {
  const amount = subject.amount;
  if (conditions.minAmount !== null) {
    if (amount === null || amount < conditions.minAmount) return false;
  }
  if (conditions.maxAmount !== null) {
    if (amount === null || amount > conditions.maxAmount) return false;
  }
  if (conditions.serviceTypes.length > 0) {
    if (subject.serviceType === null || !conditions.serviceTypes.includes(subject.serviceType)) {
      return false;
    }
  }
  if (conditions.stages.length > 0) {
    if (subject.stage === null || !conditions.stages.includes(subject.stage)) return false;
  }
  if (conditions.propertyTypes.length > 0) {
    if (
      subject.propertyType === null ||
      !conditions.propertyTypes.includes(subject.propertyType)
    ) {
      return false;
    }
  }
  if (conditions.addressContains.length > 0) {
    const hit = conditions.addressContains.some((needle) =>
      addressHas(subject.address, needle),
    );
    if (!hit) return false;
  }
  return true;
}

export interface AutomationDecision {
  send: boolean;
  /** Shown on screen, in the preview and in the run summary. Never empty. */
  reason: string;
}

function wholeDaysBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.floor((to - from) / 86_400_000);
}

/**
 * Whether this automation may act on this subject right now, and why not.
 *
 * The order of refusals is the design. A reply is checked before anything
 * else, because somebody who has answered should not be reconsidered on any
 * other ground — not by a filter, not by a timer, and not by a later edit to
 * the automation that happens to widen its reach. After that it runs cheapest
 * and most decisive first, so the reason the preview shows is the most useful
 * one rather than whichever check happened to be written last.
 *
 * Every branch returns a sentence a person can act on. "Not due" is useless in
 * a list of two hundred; "due in 4 days" tells him whether to wait.
 */
export function decide(
  automation: Pick<Automation, "enabled" | "conditions" | "action"> & {
    guards: AutomationGuards;
  },
  subject: AutomationSubject,
  clock: AutomationClock,
): AutomationDecision {
  const guards = clampGuards(automation.guards);

  if (!automation.enabled) return { send: false, reason: "This automation is switched off" };

  if (guards.stopOnReply && subject.repliedSince) {
    return { send: false, reason: "They replied — the sequence stops there" };
  }

  if (actionLeavesTheBuilding(automation.action.kind) && !subject.phone) {
    return { send: false, reason: "No phone number on the record" };
  }

  if (!matchesConditions(subject, automation.conditions)) {
    return { send: false, reason: "Filtered out by this automation's conditions" };
  }

  if (!subject.anchorAt) {
    return { send: false, reason: "Nothing on the record to measure the wait from" };
  }

  const age = wholeDaysBetween(subject.anchorAt, clock.at);
  if (age === null) return { send: false, reason: "The date on the record cannot be read" };
  if (age < 0) return { send: false, reason: "That date is in the future" };

  if (age < guards.afterDays) {
    const days = guards.afterDays - age;
    return { send: false, reason: `Due in ${days} ${days === 1 ? "day" : "days"}` };
  }

  if (age > guards.staleAfterDays) {
    return {
      send: false,
      reason: `Too old to start — ${age} days, and this one ignores anything over ${guards.staleAfterDays}`,
    };
  }

  // Checked before the count, although a once-only automation always has a
  // maxTouches of 1 and would be caught by it anyway. "This automation only
  // sends once, and it has" is a sentence somebody can act on; "already had
  // 1 of 1" invites him to go looking for a setting called 1.
  if (subject.touches > 0 && guards.repeatEveryDays === null) {
    return { send: false, reason: "This automation only sends once, and it has" };
  }

  if (subject.touches >= guards.maxTouches) {
    return {
      send: false,
      reason: `Already had ${subject.touches} of ${guards.maxTouches} from this automation`,
    };
  }

  if (subject.touches > 0) {
    if (!subject.lastTouchAt) {
      // Counted a touch but cannot say when. Refusing is the safe direction:
      // the alternative is treating it as infinitely long ago and sending.
      return { send: false, reason: "Sent before, but the date of it is missing" };
    }
    const since = wholeDaysBetween(subject.lastTouchAt, clock.at);
    if (since === null) return { send: false, reason: "The last-sent date cannot be read" };
    if (since < guards.minGapDays) {
      const days = guards.minGapDays - since;
      return {
        send: false,
        // Not "texted": the same ladder governs notes, stage moves and
        // notifications, and "texted 2 days ago" on an automation that adds
        // notes is a reason somebody would go looking for a message about.
        reason: `Last one was ${since} ${since === 1 ? "day" : "days"} ago — waiting ${days} more`,
      };
    }
    // Bound to a local because the null case already returned above, outside
    // this block, which is a fact the compiler cannot see from in here.
    const repeat = guards.repeatEveryDays;
    if (repeat !== null && since < repeat) {
      const days = repeat - since;
      return { send: false, reason: `Next one in ${days} ${days === 1 ? "day" : "days"}` };
    }
  }

  if (guards.daysOfWeek.length > 0 && !guards.daysOfWeek.includes(clock.localDay)) {
    return { send: false, reason: "Not one of this automation's sending days" };
  }

  if (clock.localHour < guards.startHour || clock.localHour >= guards.endHour) {
    return {
      send: false,
      reason: `Outside the sending hours (${guards.startHour}:00–${guards.endHour}:00)`,
    };
  }

  return { send: true, reason: "" };
}

// ---------------------------------------------------------------------------
// Validation, for the builder
// ---------------------------------------------------------------------------

export interface AutomationDraft {
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationConditions;
  action: AutomationAction;
  guards: AutomationGuards;
}

/**
 * What is wrong with a draft, in sentences meant to be read on a phone.
 *
 * Separate from `clampGuards` on purpose: clamping silently fixes a number
 * that is merely out of range, and this reports the things no default can
 * repair — an empty message, a move-stage action with nowhere to move to, a
 * text with no opt-out path. A draft with no problems is still clamped.
 */
export function validateAutomation(draft: AutomationDraft): string[] {
  const problems: string[] = [];

  if (draft.name.trim().length < 3) {
    problems.push("Give it a name you'll recognise in a list.");
  }

  if (!AUTOMATION_TRIGGERS.includes(draft.trigger)) {
    problems.push("Pick what this automation watches for.");
  }

  const needsBody = draft.action.kind === "send_sms" || draft.action.kind === "add_note";
  const body = draft.action.body.trim();
  if (needsBody && body.length === 0) {
    problems.push(
      draft.action.kind === "send_sms"
        ? "Write the text message this sends."
        : "Write the note this adds.",
    );
  }

  const strays = unknownTokens(draft.action.body);
  if (strays.length > 0) {
    problems.push(
      `${strays.map((token) => `{${token}}`).join(", ")} ${strays.length === 1 ? "is not a" : "are not"} merge field${strays.length === 1 ? "" : "s"} — it will send exactly as written.`,
    );
  }

  if (draft.action.kind === "move_stage" && !draft.action.stage) {
    problems.push("Choose the stage this moves them to.");
  }

  if (draft.action.kind === "send_sms" && body.length > 480) {
    problems.push("That text is long enough to send as four messages. Shorten it.");
  }

  const { minAmount, maxAmount } = draft.conditions;
  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
    problems.push("The smallest amount is larger than the largest one.");
  }

  return problems;
}

/** A one-line description of an automation, for the list. */
export function describeAutomation(
  automation: Pick<Automation, "trigger" | "action"> & { guards: AutomationGuards },
): string {
  const guards = clampGuards(automation.guards);
  const days = guards.afterDays;
  const when = `${days} ${days === 1 ? "day" : "days"} after ${TRIGGER_ANCHOR_LABEL[automation.trigger]}`;
  const repeat =
    guards.repeatEveryDays === null
      ? "once"
      : `up to ${guards.maxTouches}×, every ${guards.repeatEveryDays} days`;
  return `${ACTION_LABEL[automation.action.kind]}, ${when} — ${repeat}`;
}
