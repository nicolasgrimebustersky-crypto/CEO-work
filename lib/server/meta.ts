import "server-only";

import {
  parseLead,
  parseWebhookBody,
  verifyMetaSignature as verifySignature,
  type MetaLead,
} from "@/lib/meta/leads";

/**
 * Meta Lead Ads, server side.
 *
 * When someone submits an Instant Form on a Facebook or Instagram ad, Meta
 * POSTs a notification containing only a `leadgen_id` — never the answers. The
 * field data has to be fetched back from the Graph API with a Page access
 * token. That two-step is deliberate on Meta's part: a leaked webhook URL
 * alone cannot harvest anyone's contact details.
 *
 * The parsing and signature logic lives in lib/meta/leads.ts, which is pure and
 * unit-tested. This module only supplies the credentials.
 */

const GRAPH_VERSION = "v21.0";

export const metaAppSecret = process.env.META_APP_SECRET ?? "";
export const metaVerifyToken = process.env.META_VERIFY_TOKEN ?? "";
export const metaPageToken = process.env.META_PAGE_ACCESS_TOKEN ?? "";

export const isMetaConfigured =
  metaAppSecret.length > 0 && metaVerifyToken.length > 0 && metaPageToken.length > 0;

export { parseLead, parseWebhookBody };
export type { MetaLead, MetaLeadField, ParsedLead, MetaWebhookEntry } from "@/lib/meta/leads";

export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  return verifySignature(rawBody, header, metaAppSecret);
}

/**
 * Fetches the answers for a lead.
 *
 * Needs a Page access token with `leads_retrieval`. A user token will not do,
 * and the token has to belong to the Page that owns the form.
 */
export async function fetchLead(leadgenId: string): Promise<MetaLead> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}`);
  url.searchParams.set("access_token", metaPageToken);
  url.searchParams.set("fields", "id,created_time,field_data,form_id");

  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json()) as {
    id?: string;
    created_time?: string;
    form_id?: string;
    field_data?: { name?: string; values?: string[] }[];
    error?: { message?: string; code?: number };
  };

  if (!response.ok || body.error) {
    throw new Error(
      body.error?.message ?? `Graph API returned ${response.status} for lead ${leadgenId}`,
    );
  }

  return {
    id: body.id ?? leadgenId,
    createdTime: body.created_time ?? new Date().toISOString(),
    formId: body.form_id ?? null,
    fields: (body.field_data ?? []).map((field) => ({
      name: field.name ?? "",
      values: Array.isArray(field.values) ? field.values : [],
    })),
  };
}
