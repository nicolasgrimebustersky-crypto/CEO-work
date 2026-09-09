/**
 * The email that goes out when a customer approves their own estimate.
 *
 * A signed approval is the one event in this app that happens with nobody
 * watching and cannot wait for somebody to open the app. The push notification
 * already covers the phone in your pocket; this covers the case that actually
 * loses work — the phone was face down, the buzz was missed, and the customer
 * is sitting there having signed something, wondering if anyone saw.
 *
 * Free of imports for the usual reason, and one specific one: the customer's
 * typed name and their message are hostile text from a page with no login on
 * it, and they end up inside an HTML document. The escaping is therefore a
 * security boundary rather than a formatting nicety, and a boundary that cannot
 * be tested directly is one nobody should trust.
 */

export interface EmailEnv {
  RESEND_API_KEY?: string;
  /** Where the notice goes. Comma-separated to allow a second address. */
  NOTIFY_EMAIL_TO?: string;
  /** Who it comes from. Must be a domain verified with the mail provider. */
  NOTIFY_EMAIL_FROM?: string;
}

/**
 * The sender used when none is configured.
 *
 * Resend lends this address to every account so a new key works before any
 * domain is verified — but it will only deliver to the address that owns the
 * key. That is exactly the crew notice's shape (you, emailing yourself), so
 * it is a reasonable default rather than a placeholder there. A customer's
 * approval receipt is a different shape — mail to somebody who is not the
 * account owner — and left on this default it is accepted by Resend and
 * never delivered. That send needs NOTIFY_EMAIL_FROM pointed at a domain
 * verified with Resend before it reaches anyone.
 */
export const DEFAULT_FROM = "Grime Busters CRM <onboarding@resend.dev>";

export interface EmailConfig {
  canSend: boolean;
  apiKey: string;
  from: string;
  to: string[];
  /** What is missing, in words an operator can act on. */
  missing: string[];
}

const trimmed = (value: string | undefined) => (value ?? "").trim();

/**
 * Deliberately loose. The job here is to catch a pasted mistake — a name, a
 * URL, an address with the comma left in — and not to adjudicate RFC 5322,
 * which no regular expression wins anyway. The mail provider is the real judge.
 */
function looksLikeAddress(value: string): boolean {
  if (/\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

export function readRecipients(raw: string | undefined): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];

  for (const part of trimmed(raw).split(",")) {
    const address = part.trim();
    if (!address || !looksLikeAddress(address)) continue;
    // Case is preserved in what is sent, but a duplicate that differs only in
    // case is still a duplicate — two copies of the same mail is a bug.
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(address);
  }

  return addresses;
}

export function readEmailConfig(env: EmailEnv): EmailConfig {
  const apiKey = trimmed(env.RESEND_API_KEY);
  const to = readRecipients(env.NOTIFY_EMAIL_TO);
  const from = trimmed(env.NOTIFY_EMAIL_FROM) || DEFAULT_FROM;

  const missing: string[] = [];
  if (!apiKey) missing.push("RESEND_API_KEY");
  if (to.length === 0) {
    missing.push(
      trimmed(env.NOTIFY_EMAIL_TO)
        ? "NOTIFY_EMAIL_TO is set but holds no usable address"
        : "NOTIFY_EMAIL_TO",
    );
  }

  return { canSend: missing.length === 0, apiKey, from, to, missing };
}

/** One sentence naming what to go and set. */
export function emailSetupHint(config: EmailConfig): string {
  if (config.missing.length === 0) return "";
  return `Approval emails are not configured. Missing: ${config.missing.join(", ")}.`;
}

/**
 * The five characters that can end an attribute or open a tag.
 *
 * Applied to every piece of customer-supplied text before it reaches the HTML
 * body. Nothing in this email is rendered as markup on purpose, so escaping
 * everything and interpolating nothing is the whole policy.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * A yyyy-mm-dd date, in words.
 *
 * Done by pulling the three numbers out of the string rather than by
 * constructing a Date, which is the same discipline the rest of the quote flow
 * follows: `new Date("2026-09-12")` is midnight UTC, and printing that in
 * Kentucky gives the eleventh. A customer asking for Saturday and reading
 * "Friday" in the email is a booking made on the wrong day.
 */
export function spellDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value.trim();
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  if (!name) return value.trim();
  return `${name} ${Number(day)}, ${year}`;
}

export interface AcceptedNotice {
  customerName: string;
  /** The document's own number, e.g. "EST-1042". */
  number: string;
  service: string;
  /** Already formatted — the caller owns how money reads. */
  total: string;
  /** yyyy-mm-dd, as the customer picked it. */
  requestedDate: string;
  /** What they typed under the signature line. */
  signedName: string;
  /** Optional note they left with the approval. */
  message: string;
  /** Absolute link to the document in the CRM, when one can be built. */
  documentUrl: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * The notice itself.
 *
 * Written so the subject line alone is enough to act on. Approvals arrive on a
 * phone, on a ladder, between doors — if the subject says who, what and how
 * much, the body is confirmation rather than the message.
 */
export function acceptedEmail(notice: AcceptedNotice): BuiltEmail {
  const who = notice.customerName.trim() || "A customer";
  const subject = `${who} approved ${notice.number} — ${notice.total}`;

  const rows: Array<[string, string]> = [
    ["Customer", who],
    ["Estimate", notice.number],
    ["Service", notice.service],
    ["Total", notice.total],
    ["Requested date", spellDate(notice.requestedDate)],
    ["Signed", notice.signedName.trim() || who],
  ];
  if (notice.message.trim()) rows.push(["They said", notice.message.trim()]);

  const lines = rows.map(([label, value]) => `${label}: ${value}`);
  if (notice.documentUrl) lines.push("", `Open it in the CRM: ${notice.documentUrl}`);
  lines.push(
    "",
    "The signature is on the estimate in the CRM — it is not attached here.",
  );

  const text = [`${who} approved their estimate online.`, "", ...lines].join("\n");

  const cells = rows
    .map(
      ([label, value]) =>
        `<tr>` +
        `<td style="padding:6px 16px 6px 0;color:#666;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;color:#111;vertical-align:top">${escapeHtml(value)}</td>` +
        `</tr>`,
    )
    .join("");

  const link = notice.documentUrl
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(notice.documentUrl)}" style="color:#0b5cff">Open it in the CRM</a></p>`
    : "";

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111">` +
    `<p style="margin:0 0 16px"><strong>${escapeHtml(who)}</strong> approved their estimate online.</p>` +
    `<table style="border-collapse:collapse">${cells}</table>` +
    link +
    `<p style="margin:24px 0 0;color:#666;font-size:13px">The signature is on the estimate in the CRM — it is not attached here.</p>` +
    `</div>`;

  return { subject, text, html };
}

export interface CustomerApprovalNotice {
  customerName: string;
  /** The document's own number, e.g. "EST-1042". */
  number: string;
  service: string;
  /** Already formatted — the caller owns how money reads. */
  total: string;
  /** yyyy-mm-dd, as the customer picked it. */
  requestedDate: string;
  /** Blank when the business has not set one — the line is dropped, not blank. */
  businessName: string;
  businessPhone: string;
  businessEmail: string;
}

/**
 * The receipt a customer gets for approving their own estimate.
 *
 * Separate from acceptedEmail on purpose: that one is written for the crew
 * inbox — terse, ends in a link into the CRM the customer cannot open. This
 * one is written for somebody who just signed something on their phone and
 * wants to know it actually went through, so it restates what they agreed to
 * rather than assuming they still have the page open, and it names a way to
 * reach the business instead of a way to reach the record.
 */
export function customerApprovalEmail(notice: CustomerApprovalNotice): BuiltEmail {
  const first = notice.customerName.trim().split(/\s+/)[0] || "there";
  const subject = `You approved ${notice.number} — ${notice.total}`;
  const business = notice.businessName.trim() || "the crew";

  const rows: Array<[string, string]> = [
    ["Estimate", notice.number],
    ["Service", notice.service],
    ["Total", notice.total],
    ["You requested", spellDate(notice.requestedDate)],
  ];

  const contactParts: string[] = [];
  if (notice.businessPhone.trim()) contactParts.push(`call ${notice.businessPhone.trim()}`);
  if (notice.businessEmail.trim()) contactParts.push(`email ${notice.businessEmail.trim()}`);
  const contactLine = contactParts.length
    ? `Questions before then? You can ${contactParts.join(" or ")}.`
    : "";

  const lines = rows.map(([label, value]) => `${label}: ${value}`);
  const textLines = [
    `Hi ${first},`,
    "",
    `Thanks — we've got your approval for ${notice.service} (${notice.number}).`,
    "",
    ...lines,
    "",
    "We'll be in touch to confirm the date. Nothing else for you to do right now.",
  ];
  if (contactLine) textLines.push("", contactLine);
  textLines.push("", `— ${business}`);
  const text = textLines.join("\n");

  const cells = rows
    .map(
      ([label, value]) =>
        `<tr>` +
        `<td style="padding:6px 16px 6px 0;color:#666;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;color:#111;vertical-align:top">${escapeHtml(value)}</td>` +
        `</tr>`,
    )
    .join("");

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111">` +
    `<p style="margin:0 0 16px">Hi ${escapeHtml(first)},</p>` +
    `<p style="margin:0 0 16px">Thanks — we've got your approval for <strong>${escapeHtml(notice.service)}</strong> (${escapeHtml(notice.number)}).</p>` +
    `<table style="border-collapse:collapse">${cells}</table>` +
    `<p style="margin:24px 0 0">We'll be in touch to confirm the date. Nothing else for you to do right now.</p>` +
    (contactLine
      ? `<p style="margin:16px 0 0;color:#666;font-size:13px">${escapeHtml(contactLine)}</p>`
      : "") +
    `<p style="margin:24px 0 0;color:#666;font-size:13px">— ${escapeHtml(business)}</p>` +
    `</div>`;

  return { subject, text, html };
}
