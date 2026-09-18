import { readWebhookPayment } from "@/lib/payments";
import { verifyStripeSignature } from "@/lib/stripeSignature";
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
    return Response.json({ ok: false }, { status: 503 });
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

  const last4 = readLast4(event);
  const result = await recordCardPayment(payment, last4);

  if (result.problem) {
    // A real failure. 500 so Stripe retries it — the transaction is idempotent,
    // so a retry that arrives after a partial success is a no-op.
    return Response.json({ ok: false }, { status: 500 });
  }

  return Response.json({ ok: true, duplicate: result.duplicate });
}

/**
 * The card's last four, if Stripe included them.
 *
 * Optional by design: Checkout only expands payment details when asked, and a
 * payment recorded as "Card" with no digits is worth having. The digits are
 * only ever used to make a line reconcilable against a statement.
 */
function readLast4(event: unknown): string {
  const session = (event as { data?: { object?: unknown } })?.data?.object;
  if (!session || typeof session !== "object") return "";
  const details = (session as { payment_method_details?: unknown }).payment_method_details;
  if (!details || typeof details !== "object") return "";
  const card = (details as { card?: unknown }).card;
  if (!card || typeof card !== "object") return "";
  const last4 = (card as { last4?: unknown }).last4;
  return typeof last4 === "string" ? last4 : "";
}
