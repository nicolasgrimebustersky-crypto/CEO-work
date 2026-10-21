/**
 * A request from the marketing website, turned into something the CRM can file.
 *
 * Both forms on grimebusterskyllc.com — the instant quote tool and the booking
 * form — post here as well as to the email service they always used. Until
 * this existed a website enquiry was an email and nothing else: the person was
 * never a client in the CRM, so nothing followed up, nothing was on the map,
 * and the only record was whichever inbox it landed in.
 *
 * Everything arrives from an anonymous page on the open internet, so every
 * field is treated as hostile text: trimmed, capped, and never trusted for
 * looking like a phone number or a date. Pure and import-free, so each rule is
 * tested by calling it.
 */

export const WEBSITE_FORMS = ["quote", "booking"] as const;
export type WebsiteForm = (typeof WEBSITE_FORMS)[number];

export const MAX_FIELD_CHARS = 200;
export const MAX_MESSAGE_CHARS = 4000;

export interface WebsiteLeadInput {
  form?: unknown;
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  address?: unknown;
  service?: unknown;
  message?: unknown;
  preferredDate?: unknown;
  /** The quote tool's ballpark, already formatted ("$180–$240"). */
  estimate?: unknown;
  /** The quote tool's measured area and how it was measured. */
  details?: unknown;
  /** The booking form's texting checkbox. Absent on the quote tool. */
  smsConsent?: unknown;
  /** A field no person can see. Anything in it means a bot filled the form. */
  honeypot?: unknown;
}

export interface WebsiteLead {
  form: WebsiteForm;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  service: string;
  message: string;
  preferredDate: string;
  estimate: string;
  details: string;
  /** true or false when the form asked; null when it did not. */
  smsConsent: boolean | null;
}

function text(value: unknown, limit = MAX_FIELD_CHARS): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

/** Like text() but keeps the line breaks a person typed. */
function longText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit);
}

/** "Jay Rennirts" → Jay / Rennirts. "Cher" → Cher / "". "Mary Ann Smith" → Mary Ann / Smith. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** A loose email check. Real validation is the reply bouncing; this keeps junk out. */
export function cleanEmail(value: unknown): string {
  const email = text(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

/** Enough digits to be a US number, kept as typed for display. */
export function cleanPhone(value: unknown): string {
  const phone = text(value, 40);
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? phone : "";
}

/**
 * The lead, or the reason it cannot be filed.
 *
 * A name plus at least one way to reach them is the floor: a lead with no
 * phone and no email is a record nobody can act on. A filled honeypot is
 * reported as a bot so the route can answer "ok" without filing anything —
 * telling a bot it was caught only teaches it which field to leave empty.
 */
export function validateWebsiteLead(
  input: WebsiteLeadInput,
): { ok: true; value: WebsiteLead } | { ok: false; bot: boolean; problem: string } {
  if (typeof input.honeypot === "string" && input.honeypot.trim() !== "") {
    return { ok: false, bot: true, problem: "" };
  }

  const form = WEBSITE_FORMS.includes(input.form as WebsiteForm) ? (input.form as WebsiteForm) : null;
  if (!form) return { ok: false, bot: false, problem: "Unknown form." };

  const name = text(input.name, 120);
  if (!name) return { ok: false, bot: false, problem: "A name is required." };

  const phone = cleanPhone(input.phone);
  const email = cleanEmail(input.email);
  if (!phone && !email) {
    return { ok: false, bot: false, problem: "A phone number or an email address is required." };
  }

  const { firstName, lastName } = splitName(name);
  return {
    ok: true,
    value: {
      form,
      firstName,
      lastName,
      phone,
      email,
      address: text(input.address),
      service: text(input.service),
      message: longText(input.message, MAX_MESSAGE_CHARS),
      preferredDate: text(input.preferredDate, 40),
      estimate: text(input.estimate, 80),
      details: longText(input.details, 1000),
      smsConsent: typeof input.smsConsent === "boolean" ? input.smsConsent : null,
    },
  };
}

/** The note filed on the client's timeline, so the request itself is kept. */
export function websiteLeadNote(lead: WebsiteLead): string {
  const lines = [
    lead.form === "booking"
      ? "Booking request from the website."
      : "Instant quote request from the website.",
  ];
  if (lead.service) lines.push(`Service: ${lead.service}`);
  if (lead.estimate) lines.push(`Website estimate: ${lead.estimate}`);
  if (lead.preferredDate) lines.push(`Preferred date: ${lead.preferredDate}`);
  if (lead.address) lines.push(`Address given: ${lead.address}`);
  if (lead.email) lines.push(`Email: ${lead.email}`);
  if (lead.phone) lines.push(`Phone: ${lead.phone}`);
  if (lead.smsConsent === true) lines.push("Texts: agreed on the form.");
  if (lead.smsConsent === false) lines.push("Texts: declined on the form — call or email only.");
  if (lead.details) lines.push(`Details: ${lead.details}`);
  if (lead.message) lines.push("", lead.message);
  return lines.join("\n");
}
