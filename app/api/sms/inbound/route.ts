import { notifyCrew } from "@/lib/server/notify";
import { appendNote, findCustomerByPhone } from "@/lib/server/customerNotes";
import { verifyTwilioSignature } from "@/lib/server/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Twilio expects TwiML back; an empty response means "no auto-reply". */
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(): Response {
  return new Response(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * Rebuilds the exact public URL Twilio signed. Vercel terminates TLS at the
 * edge, so request.url arrives as http and the signature would never match
 * without this. TWILIO_WEBHOOK_URL overrides it if the deployment sits behind
 * something more unusual.
 */
function publicUrl(request: Request): string {
  const override = process.env.TWILIO_WEBHOOK_URL;
  if (override) return override;

  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}${url.pathname}`;
}

/**
 * Inbound SMS webhook. Point your Twilio number's "A message comes in" setting
 * at POST https://your-app.vercel.app/api/sms/inbound.
 *
 * Replies from customers land on their notes timeline so both crew see them,
 * which is the other half of "every SMS sent or received is logged".
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") params[key] = value;
    }

    // Unsigned requests are rejected outright — without this anyone who guesses
    // the URL could write arbitrary notes into the customer timeline.
    const signature = request.headers.get("x-twilio-signature");
    if (!verifyTwilioSignature(signature, publicUrl(request), params)) {
      return new Response("Invalid signature", { status: 403 });
    }

    const from = params.From ?? "";
    const body = (params.Body ?? "").trim();
    if (!from || !body) return twiml();

    const customer = await findCustomerByPhone(from);
    if (!customer) {
      // Nothing to attach it to. Returning 200 keeps Twilio from retrying a
      // message that will never match.
      console.warn(`Inbound SMS from unknown number ${from}`);
      return twiml();
    }

    const who = `${customer.firstName} ${customer.lastName}`.trim() || "Customer";

    await appendNote(customer.id, {
      text: body,
      kind: "sms_in",
      authorUid: "customer",
      authorName: who,
    });

    // A reply is the one event with a clock on it — a customer who answers and
    // hears nothing back for six hours has usually called somebody else.
    await notifyCrew({
      type: "sms_in",
      actorName: who,
      body: `${who}: ${body}`,
      customerId: customer.id,
    });

    return twiml();
  } catch (error) {
    console.error("Inbound SMS webhook failed", error);
    // Still 200: Twilio retries non-2xx, and a retry would not fix a bug here.
    return twiml();
  }
}
