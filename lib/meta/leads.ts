import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure Meta Lead Ads logic: signature verification and field mapping.
 *
 * Deliberately free of `server-only` and of any env reads, so it can be tested
 * in plain Node. Both halves of this file are places where being quietly wrong
 * is expensive — a weak signature check lets anyone inject leads that trigger
 * an automatic SMS, and a sloppy field mapping silently drops a phone number
 * that someone paid for an ad to collect.
 */

/**
 * Verifies the X-Hub-Signature-256 header against the raw request body.
 *
 * Must be given the *raw* body, byte for byte. Re-serialising the parsed JSON
 * changes key order and whitespace, and the signature will never match.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** One answer from the Instant Form. */
export interface MetaLeadField {
  name: string;
  values: string[];
}

export interface MetaLead {
  id: string;
  createdTime: string;
  formId: string | null;
  fields: MetaLeadField[];
}

function firstValue(fields: MetaLeadField[], names: string[]): string {
  for (const name of names) {
    const match = fields.find((field) => field.name.toLowerCase() === name);
    const value = match?.values?.[0]?.trim();
    if (value) return value;
  }
  return "";
}

export interface ParsedLead {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  /** Anything the form asked that we did not map, kept for the timeline. */
  extras: { label: string; value: string }[];
}

/**
 * Maps Instant Form answers onto our customer shape.
 *
 * Meta's field names vary by how the form was built — a stock form emits
 * `full_name`, a custom one might emit `what_is_your_name`. Rather than
 * guessing, anything unrecognised is preserved verbatim in `extras` and written
 * to the lead's timeline, so a mis-mapped form loses nothing.
 */
export function parseLead(lead: MetaLead): ParsedLead {
  const fields = lead.fields;

  const known = new Set([
    "first_name",
    "last_name",
    "full_name",
    "name",
    "phone_number",
    "phone",
    "email",
    "street_address",
    "address",
    "city",
    "state",
    "zip_code",
    "post_code",
  ]);

  let firstName = firstValue(fields, ["first_name"]);
  let lastName = firstValue(fields, ["last_name"]);

  if (!firstName && !lastName) {
    const full = firstValue(fields, ["full_name", "name"]);
    if (full) {
      const parts = full.split(/\s+/);
      firstName = parts[0] ?? "";
      lastName = parts.slice(1).join(" ");
    }
  }

  // Meta returns phone numbers with a country code and assorted punctuation.
  const phone = firstValue(fields, ["phone_number", "phone"]).replace(/[^\d+]/g, "");

  const street = firstValue(fields, ["street_address", "address"]);
  const city = firstValue(fields, ["city"]);
  const state = firstValue(fields, ["state"]);
  const zip = firstValue(fields, ["zip_code", "post_code"]);
  const address = [street, city, state, zip].filter(Boolean).join(", ");

  const extras = fields
    .filter((field) => !known.has(field.name.toLowerCase()))
    .map((field) => ({
      label: field.name.replace(/_/g, " "),
      value: field.values.join(", "),
    }))
    .filter((extra) => extra.value.length > 0);

  return {
    firstName,
    lastName,
    phone,
    email: firstValue(fields, ["email"]),
    address,
    extras,
  };
}

/** The shape Meta POSTs. Only `leadgen` changes are of interest. */
export interface MetaWebhookEntry {
  leadgenId: string;
  pageId: string | null;
  formId: string | null;
  createdTime: number | null;
}

export function parseWebhookBody(payload: unknown): MetaWebhookEntry[] {
  if (typeof payload !== "object" || payload === null) return [];
  const body = payload as { object?: string; entry?: unknown[] };
  if (body.object !== "page" || !Array.isArray(body.entry)) return [];

  const out: MetaWebhookEntry[] = [];
  for (const rawEntry of body.entry) {
    const entry = rawEntry as { changes?: unknown[] };
    if (!Array.isArray(entry.changes)) continue;

    for (const rawChange of entry.changes) {
      const change = rawChange as { field?: string; value?: Record<string, unknown> };
      if (change.field !== "leadgen" || !change.value) continue;

      const leadgenId = change.value.leadgen_id;
      if (typeof leadgenId !== "string" && typeof leadgenId !== "number") continue;

      out.push({
        leadgenId: String(leadgenId),
        pageId: change.value.page_id != null ? String(change.value.page_id) : null,
        formId: change.value.form_id != null ? String(change.value.form_id) : null,
        createdTime:
          typeof change.value.created_time === "number" ? change.value.created_time : null,
      });
    }
  }
  return out;
}
