import { replyNoteId } from "@/lib/replyImport";
import { classifyReply, recordOptOut } from "@/lib/smsConsent";
import { formatPhone, inboundBody } from "@/lib/inboundSms";
import { recordUnmatchedInbound } from "@/lib/server/inboundSms";
import { notifyCrew } from "@/lib/server/notify";
import { appendNote, findCustomerByPhone, setSmsOptOut } from "@/lib/server/customerNotes";
import { canVerifyWebhooks, verifyTwilioSignature } from "@/lib/server/twilio";

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
 *
 * The query string is part of what Twilio signs, so it is part of what gets
 * rebuilt. Dropping it only matters once somebody configures the webhook with
 * a parameter on the end, and then it matters completely: every single message
 * fails the signature check and comes back 403, with the 403 branch below
 * logging nothing at all. A silent total failure that depends on a character
 * in a console field is worth one call to `url.search`.
 */
function publicUrl(request: Request): string {
  const override = process.env.TWILIO_WEBHOOK_URL;
  if (override) return override;

  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}${url.pathname}${url.search}`;
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
    //
    // Twilio signs with the account auth token, never with an API key secret,
    // so an app configured with only an API key can send and cannot verify.
    // That fails closed rather than quietly accepting everything, and says why
    // — because the symptom otherwise is "replies stopped working" with a 403
    // and no clue which of the two credentials is missing.
    if (!canVerifyWebhooks) {
      console.error(
        "Inbound SMS rejected: TWILIO_AUTH_TOKEN is not set. Twilio signs webhooks " +
          "with the account auth token, so an API key alone cannot verify them.",
      );
      return new Response("Webhook verification is not configured", { status: 503 });
    }

    const signature = request.headers.get("x-twilio-signature");
    if (!verifyTwilioSignature(signature, publicUrl(request), params)) {
      return new Response("Invalid signature", { status: 403 });
    }

    const from = params.From ?? "";
    // A picture message has no Body, so the body has to be worked out from the
    // media count as well. See inboundBody: this used to be `(params.Body ??
    // "").trim()`, and a photo with no caption was dropped on the next line.
    const body = inboundBody(params.Body ?? "", Number.parseInt(params.NumMedia ?? "0", 10));
    const messageSid = params.MessageSid || params.SmsMessageSid || "";
    // Nothing from nobody. Still 200, because there is no version of this
    // Twilio could usefully send again.
    if (!from || !body) return twiml();

    const customer = await findCustomerByPhone(from);
    if (!customer) {
      // Nothing to attach it to — but somebody still wrote to the business,
      // and until now that fact died in this log line.
      //
      // The cases are not exotic: a lead texting back off an estimate link
      // from a different handset, a spouse answering from their own phone, a
      // number taken down at the door with a digit wrong. Each one is somebody
      // asking us to do work, and each one vanished.
      //
      // Still 200 to Twilio. Retrying would not conjure a customer record; the
      // message is filed where a person can see it instead.
      await recordUnmatchedInbound({
        from,
        body,
        messageSid: messageSid || undefined,
      });

      // No customerId, so `destinationFor` sends this to the Messages screen
      // rather than to a customer record that does not exist.
      await notifyCrew({
        type: "sms_in",
        actorName: formatPhone(from),
        body: `${formatPhone(from)} (not a customer yet): ${body}`,
      });

      return twiml();
    }

    const who = `${customer.firstName} ${customer.lastName}`.trim() || "Customer";

    // What the reply is asking for, before it is filed as ordinary chat.
    //
    // Twilio has already acted on STOP by the time this runs — it blocks
    // delivery itself and the customer is protected whether or not this
    // executes. What happens here is that the business finds out: the record
    // is flagged, the crew is told, and the next attempt to text them is
    // refused with a reason instead of being handed to Twilio and dropped.
    const kind = classifyReply(body);
    if (kind === "opt_out") {
      await setSmsOptOut(customer.id, recordOptOut(body));
    } else if (kind === "opt_in") {
      // They asked to come back. Clearing the flag is the whole of it — this
      // does not write a consent record, because texting START says "resume",
      // not "here is how and when I first agreed".
      await setSmsOptOut(customer.id, null);
    }

    await appendNote(customer.id, {
      text:
        kind === "opt_out"
          ? `${body}\n\n[Opted out of text messages. Call them instead, or ask them to text START.]`
          : kind === "opt_in"
            ? `${body}\n\n[Opted back in to text messages.]`
            : body,
      kind: "sms_in",
      authorUid: "customer",
      authorName: who,
      // Keyed by the SID so importing old replies later skips this one.
      id: messageSid ? replyNoteId(messageSid) : undefined,
    }, { markUnseen: true });

    // A reply is the one event with a clock on it — a customer who answers and
    // hears nothing back for six hours has usually called somebody else.
    await notifyCrew({
      type: "sms_in",
      actorName: who,
      // An opt-out is the one reply the crew must not skim past — somebody is
      // about to try texting this person again otherwise.
      body:
        kind === "opt_out"
          ? `${who} opted out of texts: ${body}`
          : `${who}: ${body}`,
      customerId: customer.id,
    });

    return twiml();
  } catch (error) {
    console.error("Inbound SMS webhook failed", error);
    // Still 200: Twilio retries non-2xx, and a retry would not fix a bug here.
    return twiml();
  }
}
