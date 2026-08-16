import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/server/admin";
import {
  fetchLead,
  isMetaConfigured,
  metaVerifyToken,
  parseLead,
  parseWebhookBody,
  verifyMetaSignature,
  type ParsedLead,
} from "@/lib/server/meta";
import { notifyCrew } from "@/lib/server/notify";
import { isTwilioConfigured, sendSms } from "@/lib/server/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Attributed to this rather than a person — no crew member typed it. */
const SYSTEM_AUTHOR = { uid: "meta", name: "Facebook lead" };

/**
 * Meta Lead Ads webhook.
 *
 * GET  — the one-time subscription handshake in the Meta app dashboard.
 * POST — a lead was submitted. The body carries only an id; the answers are
 *        fetched back from the Graph API.
 *
 * Configure at developers.facebook.com → your app → Webhooks → Page →
 * subscribe to `leadgen`, with the callback URL
 *   https://your-app.vercel.app/api/meta/leads
 * and the verify token you put in META_VERIFY_TOKEN.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && metaVerifyToken && token === metaVerifyToken) {
    // Meta expects the challenge echoed back as bare text.
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("Verification failed", { status: 403 });
}

export async function POST(request: Request): Promise<Response> {
  // The raw body, byte for byte — re-serialising the parsed JSON would change
  // key order and the signature would never match.
  const rawBody = await request.text();

  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    // Without this, anyone who guessed the URL could inject fake leads and,
    // since new leads auto-text, make this app send SMS to arbitrary numbers.
    return new Response("Invalid signature", { status: 403 });
  }

  if (!isMetaConfigured) {
    console.error("Meta webhook received but META_* env vars are incomplete");
    // 200 anyway: Meta disables a subscription that keeps erroring, and a
    // misconfiguration on our side should not cost us the subscription.
    return Response.json({ ok: false, reason: "not configured" });
  }

  let entries: ReturnType<typeof parseWebhookBody>;
  try {
    entries = parseWebhookBody(JSON.parse(rawBody));
  } catch {
    return Response.json({ ok: false, reason: "unparseable body" });
  }

  const results: { leadgenId: string; outcome: string }[] = [];

  for (const entry of entries) {
    try {
      results.push({
        leadgenId: entry.leadgenId,
        outcome: await ingestLead(entry.leadgenId, entry.formId),
      });
    } catch (error) {
      // One bad lead must not fail the batch — Meta would redeliver the whole
      // thing and we would re-import the leads that did work.
      console.error(`Meta lead ${entry.leadgenId} failed`, error);
      results.push({ leadgenId: entry.leadgenId, outcome: "error" });
    }
  }

  return Response.json({ ok: true, processed: results.length, results });
}

async function ingestLead(leadgenId: string, formId: string | null): Promise<string> {
  const db = adminDb();

  // Meta retries a webhook it thinks failed, and can deliver the same lead more
  // than once. The leadgen id is the natural idempotency key.
  const existing = await db
    .collection("customers")
    .where("sourceLeadId", "==", leadgenId)
    .limit(1)
    .get();
  if (!existing.empty) return "duplicate";

  const lead = await fetchLead(leadgenId);
  const parsed = parseLead(lead);

  const name = `${parsed.firstName} ${parsed.lastName}`.trim();
  const submitted = Timestamp.fromDate(new Date(lead.createdTime));

  const notes = [
    {
      id: crypto.randomUUID(),
      text: buildImportNote(parsed, formId),
      kind: "lead_import",
      authorUid: SYSTEM_AUTHOR.uid,
      authorName: SYSTEM_AUTHOR.name,
      createdAt: submitted,
    },
  ];

  const doc = await db.collection("customers").add({
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    phone: parsed.phone,
    email: parsed.email,
    address: parsed.address,
    // Instant Forms rarely capture a street address, and a pin in the wrong
    // place is worse than no pin. 0,0 keeps it off the map until someone adds
    // a real address; the pipeline board flags "No address yet".
    lat: 0,
    lng: 0,
    status: "lead",
    notes,
    tags: ["facebook"],
    serviceTypes: [],
    createdAt: submitted,
    createdBy: SYSTEM_AUTHOR.uid,
    createdByName: SYSTEM_AUTHOR.name,
    lastContactedAt: null,
    lastContactedBy: null,
    lastContactedByName: null,
    lifetimeValue: 0,
    pipelineStage: "new_lead",
    pipelineChangedAt: submitted,
    pipelineValue: 0,
    source: "meta_lead_ad",
    sourceLeadId: leadgenId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: SYSTEM_AUTHOR.uid,
    updatedByName: SYSTEM_AUTHOR.name,
  });

  await notifyCrew({
    type: "lead_new",
    actorName: "Facebook",
    body: `${name || parsed.phone || "Someone"} submitted an enquiry. Call them while it's warm.`,
    customerId: doc.id,
  });

  if (parsed.phone && isTwilioConfigured) {
    await acknowledge(db, doc.id, parsed);
  }

  return "created";
}

function buildImportNote(parsed: ParsedLead, formId: string | null): string {
  const lines = [`Enquiry from a Facebook/Instagram lead form${formId ? ` (${formId})` : ""}.`];
  if (parsed.email) lines.push(`Email: ${parsed.email}`);
  if (parsed.address) lines.push(`Address given: ${parsed.address}`);
  // Anything the form asked that we could not map lands here rather than
  // being silently dropped.
  for (const extra of parsed.extras) {
    lines.push(`${extra.label}: ${extra.value}`);
  }
  return lines.join("\n");
}

/**
 * Immediate acknowledgement.
 *
 * Carries an explicit STOP line: this is automated first contact with a number
 * that has consented to be contacted via the ad form, and carriers filter A2P
 * traffic without a visible opt-out.
 */
async function acknowledge(
  db: FirebaseFirestore.Firestore,
  customerId: string,
  parsed: ParsedLead,
): Promise<void> {
  const greeting = parsed.firstName ? `Hi ${parsed.firstName}, ` : "Hi, ";
  const message =
    `${greeting}thanks for your enquiry with Grime Busters. ` +
    `We've got your details and one of us will call you shortly to talk it through. ` +
    `Reply STOP to opt out.`;

  const result = await sendSms(parsed.phone, message);

  await db
    .collection("customers")
    .doc(customerId)
    .update({
      notes: FieldValue.arrayUnion({
        id: crypto.randomUUID(),
        text: result.ok ? message : `Auto-acknowledgement failed: ${result.error}`,
        kind: "sms_out",
        authorUid: SYSTEM_AUTHOR.uid,
        authorName: "Automatic reply",
        createdAt: Timestamp.now(),
      }),
      ...(result.ok
        ? {
            lastContactedAt: FieldValue.serverTimestamp(),
            lastContactedBy: SYSTEM_AUTHOR.uid,
            lastContactedByName: SYSTEM_AUTHOR.name,
          }
        : {}),
    });
}
