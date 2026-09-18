import { formatMoney } from "@/lib/format";
import { readWebhookPayment } from "@/lib/payments";
import { verifyStripeSignature } from "@/lib/stripeSignature";
import { notifyCrew } from "@/lib/server/notify";
import { recordCardPayment, stripeConfig } from "@/lib/server/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe telling us money moved.
 *
 * The only route in the app that writes to a document with neither a signed-in
 * caller nor a share token. What authorises it is the signature on the request
 * body and nothing else, so the order of operations here is the security model:
 *
 *   1. Read the RAW body. Not `request.json()` — parsing and re-serialising
 *      changes the bytes and the signature would never match again.
 *   2. Verify the signature before looking at a single field. Until that
 *      passes, the body is a string a stranger sent.
 *   3. Only then interpret it, and only for the one event type that means a
 *      customer paid.
 *
 * It answers 200 to anything it has safely decided not to act on — an event
 * type we ignore, a session that completed without being paid, a retry of
 * something already recorded. Stripe retries non-2xx responses, and retrying a
 * body this endpoint will never act on is just noise for both sides. A 4xx is
 * reserved for a body that failed verification, and a 5xx for a write that
 * genuinely failed and *should* be retried.
 */

export async function POST(request: Request): Promise<Response> {
  const config = stripeConfig();
  if (!config.webhookSecret) {
    // Nothing can be verified, so nothing can be trusted. Not an error worth
    // retrying — the deployment is simply not set up to take card payments.
    console.error("Stripe webhook received but STRIPE_WEBHOOK_SECRET is not set.");
    // 400, not a 5xx: nothing about this is going to be different on a retry,
    // and Stripe retries a 5xx on a backoff for three days.
    return Response.json({ ok: false }, { status: 400 });
  }

  const raw = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  const verified = verifyStripeSignature(raw, signature, config.webhookSecret);
  if (!verified.ok) {
    // Logged in full, answered in one word: an attacker probing this endpoint
    // learns only that it was rejected.
    console.error(`Stripe webhook rejected: ${verified.problem}`);
    return Response.json({ ok: false }, { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const payment = readWebhookPayment(event);
  // Not an event we act on, or not one that represents money actually taken.
  // Both are fine, and both are final: answering 200 stops Stripe retrying
  // something this endpoint will never do anything with.
  if (!payment) return Response.json({ ok: true, ignored: true });
  if (!payment.paid) return Response.json({ ok: true, ignored: true, reason: "not paid" });

  const result = await recordCardPayment(payment, "");

  if (result.problem) {
    if (result.permanent) {
      // Retrying cannot fix a deleted document or a tenant mismatch, and a 5xx
      // here means Stripe hammers it for three days and then drops it — money
      // taken, nothing recorded, nobody told. Answered 200 so the retries stop,
      // and logged at a volume that is meant to be noticed, because a charged
      // card with no ledger entry needs a human.
      console.error(
        `PAYMENT TAKEN BUT NOT RECORDED. Stripe session ${payment.sessionId} for document ` +
          `${payment.documentId} (${payment.amount}): ${result.problem}`,
      );
      return Response.json({ ok: true, unrecorded: true });
    }
    // Transient. 500 so Stripe retries — the transaction is idempotent, so a
    // retry arriving after a partial success is a no-op.
    return Response.json({ ok: false }, { status: 500 });
  }

  // Tell the crew, exactly once — a duplicate delivery must not buzz twice.
  // Without this the money arrives silently and somebody chases a customer who
  // has already paid, which is the same reason the quote-response route next
  // door notifies. Best-effort: notifyCrew never throws, and a failed push must
  // not turn a recorded payment into a webhook Stripe retries.
  if (result.recorded) {
    await notifyCrew({
      type: "payment_received",
      body: `Card payment of ${formatMoney(payment.amount)} received on invoice ${payment.documentId}.`,
      documentId: payment.documentId,
      actorName: "Stripe",
    });
  }

  return Response.json({ ok: true, duplicate: result.duplicate });
}

/**
 * Why there is no card last-four here.
 *
 * The obvious thing to do is read `payment_method_details.card.last4` off the
 * event. It is not there: `checkout.session.completed` carries a Checkout
 * Session, and `payment_method_details` belongs to the Charge. Webhook payloads
 * cannot be expanded, so getting the digits means a second API call to fetch
 * the PaymentIntent's latest charge.
 *
 * Not worth a blocking round-trip inside a webhook that must answer quickly, so
 * a card payment is recorded as "Card" until somebody wants the digits enough
 * to fetch them asynchronously. Written down because the first version of this
 * file read the non-existent field and silently recorded "Card" forever while
 * appearing to support last-four.
 */
