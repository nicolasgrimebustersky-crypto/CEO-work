import { checkPayable, canTakeCardPayments } from "@/lib/payments";
import { findByShareToken } from "@/lib/server/publicDocument";
import { ApiError } from "@/lib/server/auth";
import { consumeRateLimit, PAY_START_LIMIT } from "@/lib/server/rateLimit";
import { createCheckoutSession, stripeConfig } from "@/lib/server/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A customer starting to pay their own invoice.
 *
 * Reads exactly like the quote-response route next door, because it has the
 * same shape of problem: no signed-in caller, a share token in the URL doing
 * all the authorising, and a body that must be treated as text from the open
 * internet. The three limits are the same three:
 *
 *   1. It can only ever start a checkout for an *invoice* with a balance. A
 *      share link cannot be used to pay an estimate, a voided invoice, or one
 *      already settled.
 *   2. The amount is read from the stored document and never from the request.
 *      This is the important one: if the browser could name the amount, anybody
 *      with the link could pay a cent against a four-figure invoice.
 *   3. It is rate limited per document, so a leaked link cannot be turned into
 *      a Stripe session generator.
 *
 * Nothing here writes. The payment is recorded by the webhook, on Stripe's word
 * that money moved — not on the customer's browser reaching a success page,
 * which it may never do.
 */

function bad(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const found = await findByShareToken(token);
  // The same answer a made-up token gets.
  if (!found) return bad(404, "That link is no longer valid.");

  const { document, customer } = found;

  const config = stripeConfig();
  if (!canTakeCardPayments(config)) {
    return bad(503, "Card payment isn't available right now. Please call us instead.");
  }

  const payable = checkPayable(document);
  if (!payable.payable) return bad(409, payable.reason);

  try {
    await consumeRateLimit(`pay:${document.id}`, "pay_start", PAY_START_LIMIT);
  } catch (error) {
    // Only an actual limit is a limit. consumeRateLimit runs a Firestore
    // transaction, and a bare catch here told a customer who had tried zero
    // times that they had tried too many — while hiding the outage that really
    // happened.
    if (error instanceof ApiError && error.status === 429) {
      return bad(429, "Too many payment attempts on this invoice. Please try again shortly.");
    }
    console.error(`Rate limit check failed for document ${document.id}:`, error);
    return bad(503, "We couldn't start the payment just now. Please try again, or call us.");
  }

  const result = await createCheckoutSession(document, customer?.email ?? "");
  if (!result.url) {
    // The reason is already logged. A customer gets a way forward instead of a
    // Stripe error message they can do nothing with.
    return bad(502, "We couldn't start the payment. Please try again, or call us.");
  }

  return Response.json({ url: result.url });
}
