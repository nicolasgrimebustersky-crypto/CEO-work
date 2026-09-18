/**
 * Card payments, the parts of them that are pure.
 *
 * Everything here is a function of its arguments: reading config off the
 * environment, turning a dollar total into the integer minor units Stripe
 * insists on, deciding whether a webhook is one we act on, and naming the
 * payment that results. The network lives in lib/server/stripe.ts, which is
 * what lets all of this be tested without one.
 *
 * The split matters more than usual here, because the arithmetic is the part
 * that can quietly cost somebody money. A rounding error in `toMinorUnits` is
 * a customer charged the wrong amount, and that is a bug you find out about
 * from them rather than from a stack trace.
 */

export interface StripeConfig {
  secretKey: string;
  /** Verifies that a webhook really came from Stripe. */
  webhookSecret: string;
  /** Where Stripe sends the customer back to. Empty when the site URL is unset. */
  siteUrl: string;
}

export interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  NEXT_PUBLIC_SITE_URL?: string;
}

export function readStripeConfig(env: StripeEnv): StripeConfig {
  const siteUrl = (env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  return {
    secretKey: (env.STRIPE_SECRET_KEY ?? "").trim(),
    webhookSecret: (env.STRIPE_WEBHOOK_SECRET ?? "").trim(),
    // A relative return URL is not a thing Stripe accepts, so anything that is
    // not plainly absolute is treated as unset rather than passed along to fail
    // later with a worse message.
    siteUrl: /^https?:\/\//i.test(siteUrl) ? siteUrl : "",
  };
}

/**
 * Whether card payment is switched on at all.
 *
 * Deliberately all-or-nothing: a deployment with a secret key but no webhook
 * secret could take a customer's money and never record it, which is worse
 * than not offering the button. Both, or neither.
 */
export function canTakeCardPayments(config: StripeConfig): boolean {
  return Boolean(config.secretKey && config.webhookSecret && config.siteUrl);
}

/** Why the button is not being shown, for the log. Empty when it is. */
export function cardPaymentsHint(config: StripeConfig): string {
  const missing: string[] = [];
  if (!config.secretKey) missing.push("STRIPE_SECRET_KEY");
  if (!config.webhookSecret) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!config.siteUrl) missing.push("NEXT_PUBLIC_SITE_URL (absolute https URL)");
  return missing.length ? `Card payments are off: ${missing.join(", ")} not set.` : "";
}

/**
 * Dollars to cents, the way money has to be converted.
 *
 * Stripe charges integer minor units, and a plain `Math.round(amount * 100)`
 * is how a $420.15 invoice becomes a 42014 charge: 420.15 * 100 is
 * 42014.999999999996 in binary floating point.
 *
 * The epsilon nudge is deliberately the same arithmetic as `round2` in
 * lib/documents.ts, which every total in the app is rounded with. The two MUST
 * agree on the half-cent cases or the number a customer reads on their invoice
 * is not the number their card is charged: round2(1.005) is 1.01, while
 * rounding (1.005).toFixed(2) gives 1.00 — a cent, every time, silently, on
 * the side that makes the books not balance. It is copied rather than imported
 * so this module keeps no dependencies and stays testable on its own; a test
 * imports both and asserts they still agree, which is what stops them drifting.
 *
 * Throws rather than clamping. A caller that reaches here with a negative or
 * non-finite amount has a bug upstream, and charging *something* to avoid an
 * exception would be the wrong way to find out about it.
 */
export function toMinorUnits(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error("Amount is not a number.");
  if (amount < 0) throw new Error("Amount is negative.");
  const cents = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("Amount is too large.");
  return cents;
}

/** Cents back to dollars, for recording what Stripe says it actually took. */
export function fromMinorUnits(cents: number): number {
  if (!Number.isFinite(cents)) throw new Error("Amount is not a number.");
  return Number((cents / 100).toFixed(2));
}

/**
 * The smallest card payment worth offering.
 *
 * Stripe's own floor is 50 cents; below that the API rejects the session and
 * the customer sees a broken button instead of an explanation. Checked before
 * the session is created so the button is simply not offered.
 */
export const MIN_CHARGE_CENTS = 50;

export interface PayableCheck {
  payable: boolean;
  /** Why not, in words a customer could read. Empty when payable. */
  reason: string;
}

/**
 * Whether this document can be paid by card right now.
 *
 * An estimate cannot: there is nothing owed on a document that is still a
 * proposal, and offering to pay one would be inviting somebody to buy work
 * nobody has agreed to do yet.
 */
export function checkPayable(document: {
  kind: string;
  status: string;
  balanceDue: number;
}): PayableCheck {
  if (document.kind !== "invoice") {
    return { payable: false, reason: "Only an invoice can be paid." };
  }
  if (document.status === "void") {
    return { payable: false, reason: "This invoice was voided." };
  }
  if (document.balanceDue <= 0) {
    return { payable: false, reason: "This invoice is already paid in full." };
  }
  let cents: number;
  try {
    cents = toMinorUnits(document.balanceDue);
  } catch {
    return { payable: false, reason: "This invoice's balance can't be charged." };
  }
  if (cents < MIN_CHARGE_CENTS) {
    return { payable: false, reason: "The balance is below the card minimum." };
  }
  return { payable: true, reason: "" };
}

/**
 * The one webhook event that moves money into the ledger.
 *
 * Stripe sends a great many event types and will send more next year. Naming
 * the single one this app acts on means a new event type is ignored rather
 * than half-handled, and it keeps the webhook's blast radius to one sentence:
 * a completed checkout becomes a recorded payment.
 */
export const PAID_EVENT = "checkout.session.completed";

export interface WebhookPayment {
  /** The Checkout Session id — what makes recording idempotent. */
  sessionId: string;
  documentId: string;
  orgId: string;
  amount: number;
  /** Only "paid" is acted on; Stripe can complete a session that is still pending. */
  paid: boolean;
}

/**
 * What a webhook body means, or null when it means nothing to us.
 *
 * Every field is treated as untrusted input even though the signature has
 * already been checked — a valid signature proves Stripe sent it, not that it
 * is the shape this code expects. The document and org ids come back from the
 * session metadata we set when creating it, and the amount comes from Stripe's
 * own record of what was charged, never from anything the browser sent.
 */
export function readWebhookPayment(event: unknown): WebhookPayment | null {
  if (!event || typeof event !== "object") return null;
  const { type, data } = event as { type?: unknown; data?: unknown };
  if (type !== PAID_EVENT) return null;
  if (!data || typeof data !== "object") return null;

  const session = (data as { object?: unknown }).object;
  if (!session || typeof session !== "object") return null;

  const {
    id,
    amount_total: amountTotal,
    payment_status: paymentStatus,
    metadata,
  } = session as {
    id?: unknown;
    amount_total?: unknown;
    payment_status?: unknown;
    metadata?: unknown;
  };

  if (typeof id !== "string" || !id) return null;
  if (typeof amountTotal !== "number") return null;
  if (!metadata || typeof metadata !== "object") return null;

  const { documentId, orgId } = metadata as { documentId?: unknown; orgId?: unknown };
  if (typeof documentId !== "string" || !documentId) return null;
  if (typeof orgId !== "string" || !orgId) return null;

  let amount: number;
  try {
    amount = fromMinorUnits(amountTotal);
  } catch {
    return null;
  }
  if (amount <= 0) return null;

  return { sessionId: id, documentId, orgId, amount, paid: paymentStatus === "paid" };
}

/**
 * How a card payment reads in the ledger next to the cash and cheques.
 *
 * The last four digits are what makes it reconcilable against a statement, and
 * they are the only part of a card number this app ever sees or stores —
 * Stripe's hosted page takes the number, so the card itself never touches this
 * server.
 */
export function cardPaymentMethod(last4: string): string {
  const digits = last4.replace(/\D/g, "").slice(-4);
  return digits.length === 4 ? `Card ••${digits}` : "Card";
}
