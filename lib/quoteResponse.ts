/**
 * What a customer is allowed to send back about their own quote.
 *
 * Everything here arrives from a page with no login on it. The share token
 * says which document is being answered; it says nothing about who is typing,
 * so every field is treated as hostile text from the open internet and nothing
 * is trusted for being short, or being a data URL, or looking like a date.
 *
 * Free of imports so each rule can be tested directly, which matters more than
 * usual: this is the only writeable surface in the app that no signed-in
 * person stands in front of.
 */

export const DECISIONS = ["accepted", "declined"] as const;
export type Decision = (typeof DECISIONS)[number];

/**
 * A drawn signature, as a PNG data URL.
 *
 * 200 KB is far more than a finger-drawn line needs — a 600x200 canvas is
 * usually under 20 KB — and comfortably under Firestore's 1 MB document
 * ceiling, which the signature shares with the line items and the payments.
 * Above this the answer is a refusal, not a truncated image.
 */
export const MAX_SIGNATURE_BYTES = 200_000;
export const MAX_NAME_CHARS = 80;
export const MAX_MESSAGE_CHARS = 1000;

/**
 * How much a customer can write when they say no.
 *
 * Far above MAX_MESSAGE_CHARS on purpose: a no is the one answer the crew can
 * still act on, and the owner asked for comments with no word limit. Twenty
 * thousand characters is roughly 3,500 words — no real comment comes near it —
 * while still being a ceiling, because this arrives from the open internet and
 * lands inside a document that Firestore caps at 1 MB alongside its line
 * items and any signature.
 */
export const MAX_DECLINE_MESSAGE_CHARS = 20_000;

/**
 * Why a customer said no. Optional: a customer must always be able to decline
 * without explaining. The keys are stored; the labels are what both the CRM
 * and the website show, so they live here once.
 */
export const DECLINE_REASONS = [
  { key: "price", label: "The price is more than I expected" },
  { key: "timing", label: "Not the right time" },
  { key: "another_company", label: "I went with another company" },
  { key: "doing_it_myself", label: "I'll do it myself" },
  { key: "scope", label: "It doesn't include what I need" },
  { key: "no_longer_needed", label: "I don't need it anymore" },
  { key: "other", label: "Something else" },
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number]["key"];

export function isDeclineReason(value: unknown): value is DeclineReason {
  return typeof value === "string" && DECLINE_REASONS.some((reason) => reason.key === value);
}

/** The label for a stored reason, or "" for none or one no longer listed. */
export function declineReasonLabel(value: unknown): string {
  return DECLINE_REASONS.find((reason) => reason.key === value)?.label ?? "";
}

/** How far ahead a customer may ask for. Beyond this it is not scheduling. */
export const MAX_DAYS_AHEAD = 180;

export interface QuoteResponseInput {
  decision: string;
  /** Typed name, which is what makes the drawn line attributable. */
  signedName?: string | null;
  /** PNG data URL of the drawn signature. */
  signature?: string | null;
  /** Preferred date, yyyy-mm-dd. Weekends included: the crew work them. */
  requestedDate?: string | null;
  /** Free text — a question on decline, or a note on approval. */
  message?: string | null;
  /** On a decline only: one of DECLINE_REASONS' keys. */
  reason?: string | null;
}

export interface CleanQuoteResponse {
  decision: Decision;
  signedName: string;
  signature: string;
  requestedDate: string;
  message: string;
  /** A DECLINE_REASONS key on a decline that gave one, otherwise "". */
  reason: DeclineReason | "";
}

export function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && (DECISIONS as readonly string[]).includes(value);
}

/** Collapses runs of whitespace and trims. Newlines survive in messages. */
function tidy(value: unknown, keepNewlines = false): string {
  if (typeof value !== "string") return "";
  const collapsed = keepNewlines
    ? value.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n")
    : value.replace(/\s+/g, " ");
  return collapsed.trim();
}

export function cleanName(value: unknown): string {
  return tidy(value).slice(0, MAX_NAME_CHARS);
}

export function cleanMessage(value: unknown, limit: number = MAX_MESSAGE_CHARS): string {
  return tidy(value, true).slice(0, limit);
}

/**
 * A PNG data URL, or "".
 *
 * Only PNG, and only base64. Accepting `image/svg+xml` here would be accepting
 * a script that runs whenever the crew open the document — a signature is a
 * picture of a line, and there is no reason for it to be anything that can
 * execute.
 */
export function cleanSignature(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return "";
  if (trimmed.length > MAX_SIGNATURE_BYTES) return "";
  return trimmed;
}

/**
 * A calendar date the customer picked, as yyyy-mm-dd, or "".
 *
 * Compared as strings against a caller-supplied "today" rather than by parsing
 * into a Date. `new Date("2026-09-04")` is midnight UTC, which is the previous
 * evening in Kentucky — so a customer tapping today's date would have it
 * rejected as past, in the evening, some of the time. Lexicographic comparison
 * of yyyy-mm-dd has no timezone in it at all.
 *
 * Weekends are deliberately allowed. The crew work them.
 */
export function cleanRequestedDate(value: unknown, today: string): string {
  if (typeof value !== "string") return "";
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";

  // Rejects 2026-13-40 and 2026-02-31, which match the pattern above.
  const [year, month, day] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return "";
  }

  if (date < today) return "";

  const limit = new Date(Date.UTC(year, month - 1, day));
  const [ty, tm, td] = today.split("-").map(Number);
  const from = Date.UTC(ty, tm - 1, td);
  if ((limit.getTime() - from) / 86_400_000 > MAX_DAYS_AHEAD) return "";

  return date;
}

/**
 * The whole response, or the first reason it cannot be accepted.
 *
 * Approving is the branch that needs everything: a name and a drawn line,
 * because that is what makes it a signature rather than a tap, and a date,
 * because the next question after "yes" is always "when". Declining needs
 * nothing — a customer who wants to say no and nothing else must be able to.
 */
export function validateQuoteResponse(
  input: QuoteResponseInput,
  today: string,
): { ok: true; value: CleanQuoteResponse } | { ok: false; problem: string } {
  if (!isDecision(input.decision)) {
    return { ok: false, problem: "Tell us whether you are approving this quote." };
  }

  if (input.decision === "declined") {
    return {
      ok: true,
      value: {
        decision: "declined",
        signedName: "",
        signature: "",
        requestedDate: "",
        message: cleanMessage(input.message, MAX_DECLINE_MESSAGE_CHARS),
        // An unknown reason is dropped, not refused: saying no must never fail
        // because the reason list changed under an open page.
        reason: isDeclineReason(input.reason) ? input.reason : "",
      },
    };
  }

  const message = cleanMessage(input.message);

  const signedName = cleanName(input.signedName);
  if (signedName.length < 2) {
    return { ok: false, problem: "Please type your name to sign." };
  }

  const signature = cleanSignature(input.signature);
  if (!signature) {
    return { ok: false, problem: "Please draw your signature in the box." };
  }

  const requestedDate = cleanRequestedDate(input.requestedDate, today);
  if (!requestedDate) {
    return { ok: false, problem: "Please pick a date that works for you." };
  }

  return {
    ok: true,
    value: { decision: "accepted", signedName, signature, requestedDate, message, reason: "" },
  };
}

/** Today in a fixed timezone, as yyyy-mm-dd. The business is in Kentucky. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as yyyy-mm-dd, which is what the date input speaks.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
