/**
 * Who may be texted, and who has told us to stop.
 *
 * Two separate questions, and conflating them is the mistake this module
 * exists to prevent:
 *
 *   Consent — did this person agree to be texted at all? Recorded when the
 *   number is taken, on the quote form or at a door. Its absence is not a
 *   refusal; it is a record written before anyone asked.
 *
 *   Opt-out — did this person, having been texted, tell us to stop? That is
 *   an instruction, and it outranks everything, including a consent recorded
 *   five minutes earlier.
 *
 * Twilio already blocks delivery to a number that replied STOP, so nothing
 * here is what keeps us lawful. What it changes is that the business knows.
 * Without it the app keeps queuing messages Twilio silently drops, the crew
 * sees "sent" against a customer who will never receive anything, and nobody
 * learns why that customer went quiet.
 *
 * Pure and dependency-free so the rules can be tested directly rather than
 * inferred from a working webhook.
 */

/**
 * The words a customer uses to stop the messages.
 *
 * This is the CTIA list that carriers require every campaign to honour, plus
 * the plain-English variants people actually send. Twilio recognises the
 * standard set itself; we match a wider one because our purpose is different
 * from its purpose — Twilio is deciding whether to block delivery, we are
 * deciding whether to write "this person asked us to stop" where the crew can
 * see it. Catching "unsubscribe me" a beat early costs nothing; missing it
 * means somebody gets called about a job they wanted nothing more to do with.
 */
const OPT_OUT_WORDS = new Set([
  "stop",
  "stopall",
  "stop all",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "optout",
  "opt out",
  "remove me",
  "unsubscribe me",
  "no more texts",
  "stop texting me",
  "stop texting",
  "leave me alone",
]);

/**
 * The words that put somebody back on.
 *
 * Deliberately NOT including YES, though it is one of the carrier defaults.
 * Our estimate text says "Reply YES to book it" — YES is how a customer
 * accepts a quote, and treating that as a subscription instruction would
 * silently clear an opt-out somebody meant. The campaign registered with
 * Twilio lists START and UNSTOP only, for exactly this reason; this set
 * matches it on purpose, and changing one without the other reintroduces the
 * collision.
 */
const OPT_IN_WORDS = new Set(["start", "unstop", "yes please text me", "resubscribe"]);

/** The words that ask for help. Answered by Twilio; recorded by us. */
const HELP_WORDS = new Set(["help", "info"]);

export type ReplyKind = "opt_out" | "opt_in" | "help" | "message";

/**
 * What a customer's reply is asking for.
 *
 * Matched on the whole message, not on whether it contains the word. "Stop by
 * around 3 and we'll be home" is not an opt-out, and treating it as one would
 * cut off a customer who was confirming an appointment. Carriers match the
 * same way, on the message being the keyword rather than containing it.
 *
 * Punctuation is stripped because "STOP." and "Stop!" are both the keyword,
 * and an exclamation mark is not a change of mind.
 */
export function classifyReply(raw: string | null | undefined): ReplyKind {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase()
    // Trailing and leading punctuation only. Interior punctuation would make
    // "stop.texting" match, which is a sentence fragment rather than a keyword.
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    // Collapse runs of whitespace so "stop  all" reaches "stop all".
    .replace(/\s+/g, " ");

  if (!text) return "message";
  if (OPT_OUT_WORDS.has(text)) return "opt_out";
  if (OPT_IN_WORDS.has(text)) return "opt_in";
  if (HELP_WORDS.has(text)) return "help";
  return "message";
}

/** How somebody came to agree to be texted. */
export const CONSENT_METHODS = ["verbal", "web_form", "written"] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/**
 * The record of somebody agreeing to be texted.
 *
 * Who asked and when are part of it rather than decoration: the verbal script
 * filed with the A2P campaign states that consent, the date and the crew
 * member are recorded, and a field that stores only `true` cannot support
 * that claim if it is ever questioned.
 */
export interface SmsConsent {
  granted: boolean;
  method: ConsentMethod;
  /** ISO 8601. A string rather than a Timestamp so this module stays pure. */
  at: string;
  /** The crew member who asked. "customer" when they ticked the box themselves. */
  byUid: string;
  byName: string;
}

/** The record of somebody telling us to stop. */
export interface SmsOptOut {
  at: string;
  /** What they actually sent, so a wrong classification is auditable. */
  keyword: string;
}

/** The parts of a customer this module needs. */
export interface Textable {
  phone?: string | null;
  smsConsent?: SmsConsent | null;
  smsOptOut?: SmsOptOut | null;
}

export interface SendVerdict {
  allowed: boolean;
  /** Shown to the crew. Empty when allowed. */
  reason: string;
}

/**
 * Whether we may text this customer.
 *
 * The order matters. An opt-out is checked first and wins outright, including
 * over a consent recorded afterwards — somebody who says stop and is then
 * ticked as consenting by a crew member has been overridden by a colleague,
 * not persuaded, and the only safe reading is that the instruction stands.
 * Clearing an opt-out takes a deliberate act: the customer texts START, or
 * somebody records a fresh consent through `grantConsent` below, which says
 * in its own name that a person asked.
 *
 * A missing consent record is permitted, and this is the deliberate part.
 * Every customer entered before consent was tracked has none, and refusing to
 * text them would mean a business that cannot contact its own customers the
 * day this ships. What it returns instead is `allowed` with a reason the UI
 * can show, so the crew sees "no consent recorded" and can ask.
 */
export function canSendTo(customer: Textable): SendVerdict {
  if (!customer.phone) {
    return { allowed: false, reason: "No phone number on this customer." };
  }
  if (customer.smsOptOut) {
    return {
      allowed: false,
      reason: "This customer replied STOP. Call them instead, or ask them to text START.",
    };
  }
  if (customer.smsConsent && customer.smsConsent.granted === false) {
    return {
      allowed: false,
      reason: "This customer declined text messages. Call them instead.",
    };
  }
  return { allowed: true, reason: "" };
}

/**
 * Whether the crew should be nudged to ask for consent.
 *
 * Separate from canSendTo because it answers a different question — not "may
 * we" but "should somebody ask". A record with no consent either way is the
 * one worth prompting about; a recorded no is settled.
 */
export function needsConsentAsked(customer: Textable): boolean {
  if (customer.smsOptOut) return false;
  return !customer.smsConsent;
}

/** A consent record, stamped. `now` is injected so tests are not clock-dependent. */
export function grantConsent(
  method: ConsentMethod,
  by: { uid: string; name: string },
  now: Date = new Date(),
): SmsConsent {
  return {
    granted: true,
    method,
    at: now.toISOString(),
    byUid: by.uid,
    byName: by.name,
  };
}

/** A recorded refusal — "no texts, call only". */
export function declineConsent(
  method: ConsentMethod,
  by: { uid: string; name: string },
  now: Date = new Date(),
): SmsConsent {
  return {
    granted: false,
    method,
    at: now.toISOString(),
    byUid: by.uid,
    byName: by.name,
  };
}

/** An opt-out record, from the reply that caused it. */
export function recordOptOut(keyword: string, now: Date = new Date()): SmsOptOut {
  return { at: now.toISOString(), keyword: String(keyword ?? "").trim().slice(0, 40) };
}

/** One line for the customer screen, so consent is visible before anyone texts. */
export function consentLabel(customer: Textable): string {
  if (customer.smsOptOut) return "Replied STOP — do not text";
  const consent = customer.smsConsent;
  if (!consent) return "No text consent recorded";
  const when = consent.at.slice(0, 10);
  if (!consent.granted) return `Declined texts on ${when}`;
  const how =
    consent.method === "web_form"
      ? "on the website form"
      : consent.method === "written"
        ? "in writing"
        : "verbally";
  return `Agreed to texts ${how} on ${when}${consent.byName ? ` (${consent.byName})` : ""}`;
}
