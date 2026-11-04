/**
 * Reading a Venmo "paid you" email.
 *
 * Venmo has no API or webhook for a personal account, but it emails the
 * account holder every time somebody pays them: "Larry Lupinski paid you
 * $45.00", with the payer's note in the body. Forwarded from iCloud to the
 * CRM's private inbound address (app/api/inbound/venmo), that email is the
 * only machine-readable record of the payment there is.
 *
 * This file only reads. Whether the email really came from Venmo is decided
 * by its DKIM signature in lib/server/venmo.ts, and nothing here should be
 * trusted before that check passes.
 *
 * Free of imports so every rule is tested by calling it.
 */

export interface VenmoPayment {
  /** Who paid, as Venmo shows their name. */
  payerName: string;
  /** Dollars, two decimals. */
  amount: number;
  /** What they typed in the note, or "" when there was none. */
  note: string;
}

/** "Larry Lupinski paid you $45.00", tolerant of commas and missing cents. */
const SUBJECT = /^\s*(?:fwd?:\s*)*(.+?)\s+paid you\s+\$\s?([\d,]+(?:\.\d{1,2})?)\s*$/i;

/** Subjects Venmo sends for money going the other way, or not moving at all. */
const NOT_INCOMING = /\b(you paid|requests?|charged you|declined|cancel+ed|reminder)\b/i;

function toAmount(text: string): number | null {
  const value = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > 100_000) return null;
  return Math.round(value * 100) / 100;
}

/**
 * The note, from the plain-text body.
 *
 * Venmo's layout puts the note on the line or two after the "paid you" line,
 * before the money and footer boilerplate. Rather than trust one exact layout,
 * this takes the first short line after the headline that is not boilerplate.
 * A wrong note costs nothing: it only ever narrows a match, and a payment
 * whose note matches nothing still goes to the list to be matched by hand.
 */
const BOILERPLATE =
  /^(\$|venmo|transfer|money (credited|deposited|available)|see transaction|transaction (details|id)|date$|sent to|view (in|on)|payment id|privacy|help|terms|©|copyright|this email|you received|sent from|download|like|comment|https?:\/\/)/i;

export function noteFromBody(text: string, payerName: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const headline = lines.findIndex((line) => /paid you/i.test(line));
  if (headline === -1) return "";
  for (const line of lines.slice(headline + 1, headline + 6)) {
    if (BOILERPLATE.test(line)) continue;
    if (line.toLowerCase() === payerName.toLowerCase()) continue;
    if (/^[\d\s:,/APMapm.-]+$/.test(line)) continue; // a date or a time
    if (line.length > 200) continue;
    return line;
  }
  return "";
}

/**
 * The payment an email describes, or null when it is not an incoming Venmo
 * payment: a request, a payment Nicolas made, a newsletter, or a subject in a
 * shape this does not recognise. Null sends nothing anywhere.
 */
export function parseVenmoEmail(email: { subject: string; text: string }): VenmoPayment | null {
  const match = SUBJECT.exec(email.subject ?? "");
  if (!match) return null;
  const payerName = match[1].replace(/\s+/g, " ").trim();
  if (!payerName || NOT_INCOMING.test(payerName)) return null;
  const amount = toAmount(match[2]);
  if (amount === null) return null;
  return { payerName, amount, note: noteFromBody(email.text ?? "", payerName) };
}
