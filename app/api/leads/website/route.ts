import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { DEFAULT_ORG_ID, asOrgId } from "@/lib/org";
import { phoneKey } from "@/lib/portalMatch";
import { adminDb } from "@/lib/server/admin";
import { preflight, withCors } from "@/lib/server/cors";
import { notifyCrew } from "@/lib/server/notify";
import { consumeRateLimit, WEBSITE_LEAD_LIMIT } from "@/lib/server/rateLimit";
import { declineConsent, grantConsent } from "@/lib/smsConsent";
import { validateWebsiteLead, websiteLeadNote, type WebsiteLead } from "@/lib/websiteLead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * A request from one of the website's forms, filed as a client.
 *
 * The website posts here alongside the email it has always sent, so a form
 * submission now does three things: the email still arrives, the person is a
 * client in the CRM with a blue "new" dot (`unseenSince`) until somebody opens
 * their profile, and the crew get a push.
 *
 * No login, by design — it is a public form. What guards it instead:
 *   - a per-address rate limit (WEBSITE_LEAD_LIMIT);
 *   - a honeypot, answered with a quiet "ok" so a bot learns nothing;
 *   - lib/websiteLead.ts treating every field as hostile text;
 *   - CORS limited to the website's origins (lib/server/cors.ts), which
 *     stops other sites' pages posting from a visitor's browser.
 *
 * Somebody who is already a client — same phone or same email — is not filed
 * twice. Their record gets the request as a note and the blue dot again, so a
 * returning customer asking for more work is as visible as a new one.
 */

const SYSTEM = { uid: "website", name: "Website form" };

function senderAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function reply(request: Request, body: Record<string, unknown>, status = 200): Response {
  return withCors(request, body, { status });
}

export async function POST(request: Request): Promise<Response> {
  try {
    await consumeRateLimit(`ip:${senderAddress(request)}`, "website_lead", WEBSITE_LEAD_LIMIT);
  } catch {
    return reply(request, { ok: false, error: "Too many requests. Please call us instead." }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(request, { ok: false, error: "That did not arrive properly." }, 400);
  }

  const checked = validateWebsiteLead((body ?? {}) as Record<string, unknown>);
  if (!checked.ok) {
    if (checked.bot) return reply(request, { ok: true });
    return reply(request, { ok: false, error: checked.problem }, 400);
  }

  try {
    const outcome = await fileLead(checked.value);
    return reply(request, { ok: true, outcome });
  } catch (error) {
    console.error("Website lead could not be filed", error);
    return reply(request, { ok: false, error: "We could not save that just now." }, 500);
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}

/** Somebody already on file under this phone or email, in this business. */
async function findExisting(
  lead: WebsiteLead,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const customers = adminDb().collection("customers");
  const key = phoneKey(lead.phone);
  const lookups: Array<Promise<FirebaseFirestore.QuerySnapshot>> = [];
  if (key) lookups.push(customers.where("phoneE164", "==", key).limit(5).get());
  if (lead.email) lookups.push(customers.where("email", "==", lead.email).limit(5).get());

  for (const snap of await Promise.all(lookups)) {
    // The Admin SDK bypasses the rules, so the org is checked here.
    const mine = snap.docs.find((doc) => asOrgId(doc.get("orgId")) === DEFAULT_ORG_ID);
    if (mine) return mine;
  }
  return null;
}

async function fileLead(lead: WebsiteLead): Promise<"created" | "updated"> {
  const now = Timestamp.now();
  const note = {
    id: crypto.randomUUID(),
    text: websiteLeadNote(lead),
    kind: "lead_import",
    authorUid: SYSTEM.uid,
    authorName: SYSTEM.name,
    createdAt: now,
  };
  const consent =
    lead.smsConsent === null
      ? null
      : lead.smsConsent
        ? grantConsent("web_form", { uid: "customer", name: `${lead.firstName} ${lead.lastName}`.trim() })
        : declineConsent("web_form", { uid: "customer", name: `${lead.firstName} ${lead.lastName}`.trim() });
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  const what = lead.form === "booking" ? "booked" : "asked for a quote";

  const existing = await findExisting(lead);
  if (existing) {
    const patch: Record<string, unknown> = {
      notes: FieldValue.arrayUnion(note),
      unseenSince: now,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: SYSTEM.uid,
      updatedByName: SYSTEM.name,
    };
    // Fill gaps, never overwrite what the crew entered.
    if (!existing.get("email") && lead.email) patch.email = lead.email;
    if (!existing.get("address") && lead.address) patch.address = lead.address;
    if (!existing.get("phone") && lead.phone) {
      patch.phone = lead.phone;
      patch.phoneE164 = phoneKey(lead.phone) ?? "";
    }
    // Their latest answer on the form is their current wish — but a STOP they
    // texted outranks any box ticked on a website, so it is never cleared here.
    if (consent && !existing.get("smsOptOut")) patch.smsConsent = consent;
    await existing.ref.update(patch);

    await notifyCrew({
      type: "lead_new",
      actorName: "Website",
      body: `${name || "A client"} ${what} again on the website${lead.service ? ` — ${lead.service}` : ""}.`,
      customerId: existing.id,
    });
    return "updated";
  }

  const doc = await adminDb()
    .collection("customers")
    .add({
      firstName: lead.firstName,
      lastName: lead.lastName,
      phone: lead.phone,
      phoneE164: phoneKey(lead.phone) ?? "",
      email: lead.email,
      address: lead.address,
      lat: 0,
      lng: 0,
      status: "lead",
      notes: [note],
      tags: ["website"],
      serviceTypes: [],
      propertyType: "residential",
      addresses: [],
      ...(consent ? { smsConsent: consent } : {}),
      orgId: DEFAULT_ORG_ID,
      createdAt: now,
      createdBy: SYSTEM.uid,
      createdByName: SYSTEM.name,
      lastContactedAt: null,
      lastContactedBy: null,
      lastContactedByName: null,
      lifetimeValue: 0,
      pipelineStage: "new_lead",
      pipelineChangedAt: now,
      pipelineValue: 0,
      source: lead.form === "booking" ? "website_booking" : "website_quote",
      unseenSince: now,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: SYSTEM.uid,
      updatedByName: SYSTEM.name,
    });

  await notifyCrew({
    type: "lead_new",
    actorName: "Website",
    body: `${name || "Someone"} ${what} on the website${lead.service ? ` — ${lead.service}` : ""}. Call them while it's warm.`,
    customerId: doc.id,
  });
  return "created";
}
