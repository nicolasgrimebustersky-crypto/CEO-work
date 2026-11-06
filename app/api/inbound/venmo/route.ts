import { formatMoney } from "@/lib/format";
import { notifyCrew } from "@/lib/server/notify";
import { ingestVenmoEmail, venmoConfig } from "@/lib/server/venmo";
import { verifySvixSignature } from "@/lib/svixSignature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resend telling us an email arrived for the Venmo inbound address.
 *
 * Two independent checks stand between a stranger and a bill marked paid:
 *
 *   1. This request's Svix signature, with RESEND_INBOUND_SECRET. Proves the
 *      call came from Resend, so nobody can POST a fake event here.
 *   2. Venmo's DKIM signature on the email itself (lib/server/venmo.ts).
 *      Proves Venmo wrote it, so nobody can email the inbound address a fake
 *      "paid you". Without this, anyone who learned the address could mark
 *      any bill paid.
 *
 * The event carries only the email's id; the body is fetched from Resend's
 * API, which is authenticated with our own key.
 *
 * Status codes: 400 for a request that failed verification, 500 for a
 * failure worth Resend retrying (the work is idempotent on the email id), 200
 * for everything decided — including emails deliberately not acted on.
 */
export async function POST(request: Request): Promise<Response> {
  const config = venmoConfig();
  if (!config.webhookSecret || !config.apiKey || !config.inboundAddress) {
    console.error("Venmo inbound webhook called but RESEND_INBOUND_SECRET, RESEND_API_KEY or VENMO_INBOUND_ADDRESS is not set.");
    return Response.json({ ok: false }, { status: 400 });
  }

  const raw = await request.text();
  const verified = verifySvixSignature(
    raw,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    config.webhookSecret,
  );
  if (!verified.ok) {
    console.error(`Venmo inbound webhook rejected: ${verified.problem}`);
    return Response.json({ ok: false }, { status: 400 });
  }

  let event: { type?: unknown; data?: { email_id?: unknown } };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (event.type !== "email.received" || typeof event.data?.email_id !== "string") {
    return Response.json({ ok: true, ignored: true });
  }

  let result;
  try {
    result = await ingestVenmoEmail(event.data.email_id, config);
  } catch (error) {
    console.error(`Venmo inbound email ${event.data.email_id} failed: ${(error as Error).message}`);
    return Response.json({ ok: false }, { status: 500 });
  }

  if (result.payment && (result.outcome === "applied" || result.outcome === "needs_match" || result.outcome === "unverified")) {
    const { payerName, amount } = result.payment;
    await notifyCrew({
      type: "payment_received",
      body:
        result.outcome === "applied"
          ? `${payerName} paid ${formatMoney(amount)} on Venmo — marked paid (${result.detail}).`
          : result.outcome === "needs_match"
            ? `${payerName} paid ${formatMoney(amount)} on Venmo. Open Money to match it: ${result.detail}.`
            : `An email claiming ${payerName} paid ${formatMoney(amount)} on Venmo failed Venmo's signature check and was not applied.`,
      customerId: result.customerId ?? null,
      actorName: "Venmo",
    });
  }

  return Response.json({ ok: true, outcome: result.outcome });
}
