import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/server/admin";
import {
  cardPaymentMethod,
  readStripeConfig,
  toMinorUnits,
  type StripeConfig,
  type WebhookPayment,
} from "@/lib/payments";
import { statusAfterPayment, sumPayments, type Payment } from "@/lib/documents";
import type { SerialDocument } from "@/lib/server/publicDocument";

/**
 * Taking a card, via Stripe's HTTP API.
 *
 * No SDK, for the reason lib/server/email.ts gives about Resend: the surface
 * used here is two POSTs, and a dependency that wraps two POSTs is a dependency
 * to audit and upgrade forever. `fetch` and `node:crypto` are already in the
 * runtime.
 *
 * The customer never types a card number into this app. Stripe Checkout is a
 * hosted page on Stripe's domain — this code creates a session and hands back
 * its URL, the customer pays there, and Stripe reports the result to the
 * webhook. That is the whole reason to do it this way: no card number ever
 * reaches this server, so there is no card data here to leak.
 */

/**
 * A payment as it is written through the Admin SDK.
 *
 * Identical to `Payment` in every field that is stored; the one difference is
 * that `Timestamp` here is firebase-admin's, and the client SDK's type of the
 * same name is not structurally the same. Firestore stores one thing either
 * way — this only exists so the server side does not have to lie about which
 * class it is holding.
 */
type StoredPayment = Omit<Payment, "receivedAt"> & { receivedAt: Timestamp };

const TIMEOUT_MS = 10_000;

export function stripeConfig(): StripeConfig {
  return readStripeConfig({
    // Named one by one rather than handing over process.env whole — Next
    // replaces these at build time by literal name, so a dynamic lookup is not
    // guaranteed to find them.
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
}

export interface CheckoutResult {
  url: string;
  /** Why not, when not. Logged; the customer sees a generic message. */
  problem: string;
}

/**
 * A Checkout Session for what is still owed on an invoice.
 *
 * The amount is computed here from the stored document, never taken from the
 * request. That is the load-bearing decision in this file: the caller is a
 * public route reachable by anybody holding a share link, and if the browser
 * could name the amount then anybody could pay one cent against a $4,000
 * invoice and have it recorded as a payment.
 */
export async function createCheckoutSession(
  document: SerialDocument,
  customerEmail: string,
  config: StripeConfig = stripeConfig(),
): Promise<CheckoutResult> {
  if (!config.secretKey || !config.siteUrl) {
    return { url: "", problem: "Card payments are not configured on this deployment." };
  }

  let amountCents: number;
  try {
    amountCents = toMinorUnits(document.balanceDue);
  } catch (error) {
    return { url: "", problem: `Balance cannot be charged: ${(error as Error).message}` };
  }

  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][price_data][product_data][name]": `Invoice ${document.number}`,
    // Where Stripe sends them afterwards. Back to their own copy of the
    // invoice either way: paid, it now reads as paid; cancelled, nothing
    // happened and the button is still there.
    success_url: `${config.siteUrl}/v/${document.shareToken}?paid=1`,
    cancel_url: `${config.siteUrl}/v/${document.shareToken}`,
    // Read back off the webhook. The document id never travels via the browser.
    "metadata[documentId]": document.id,
    "metadata[orgId]": document.orgId,
    client_reference_id: document.id,
  });
  if (customerEmail) body.set("customer_email", customerEmail);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Stripe replays a repeated key rather than creating a second session,
        // so a double-tapped button cannot open two checkouts for one balance.
        "Idempotency-Key": `doc_${document.id}_${amountCents}`,
      },
      body,
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as { url?: unknown; error?: { message?: string } } | null;

    if (!response.ok) {
      // Stripe explains itself, and the explanation is about the request, never
      // about the key.
      const detail = payload?.error?.message ?? `HTTP ${response.status}`;
      console.error(`Stripe refused the session: ${detail}`);
      return { url: "", problem: detail };
    }
    if (!payload || typeof payload.url !== "string" || !payload.url) {
      return { url: "", problem: "Stripe returned a session with no URL." };
    }
    return { url: payload.url, problem: "" };
  } catch (error) {
    const problem = controller.signal.aborted ? "Stripe timed out." : (error as Error).message;
    console.error(`Stripe session failed: ${problem}`);
    return { url: "", problem };
  } finally {
    clearTimeout(timer);
  }
}

export interface RecordResult {
  recorded: boolean;
  /** True when this session was already in the ledger — a retry, not a problem. */
  duplicate: boolean;
  problem: string;
}

/**
 * Write a completed card payment into the document's ledger, once.
 *
 * Everything about this is shaped by the fact that Stripe will call it more
 * than once. It retries until it gets a 2xx, and a delivery that timed out
 * *after* the write looks exactly like one that never arrived. So the check for
 * an existing payment with this session id and the append happen inside one
 * transaction: two concurrent retries cannot both pass the check.
 *
 * The amount written is Stripe's, not the invoice's. If the two disagree —
 * because somebody edited the invoice while the customer had checkout open —
 * the money that actually moved is the true number, and the balance should
 * reflect what was really taken.
 */
export async function recordCardPayment(
  payment: WebhookPayment,
  last4: string,
): Promise<RecordResult> {
  const db = adminDb();
  const ref = db.collection("documents").doc(payment.documentId);

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { recorded: false, duplicate: false, problem: "Document no longer exists." };

      const data = snap.data() as { orgId?: string; total?: number; status?: string; payments?: StoredPayment[] };

      // The org on the document must match the one the session was created
      // for. Metadata is signed by Stripe, but it is still an assertion about
      // which tenant this belongs to, and it is cheap to refuse a mismatch.
      if (data.orgId && payment.orgId && data.orgId !== payment.orgId) {
        return { recorded: false, duplicate: false, problem: "Payment is for a different organisation." };
      }

      const existing: StoredPayment[] = Array.isArray(data.payments) ? data.payments : [];
      if (existing.some((entry) => entry?.providerRef === payment.sessionId)) {
        return { recorded: false, duplicate: true, problem: "" };
      }

      const entry: StoredPayment = {
        id: `stripe-${payment.sessionId}`,
        amount: payment.amount,
        receivedAt: Timestamp.now(),
        method: cardPaymentMethod(last4),
        // Not a crew member. Naming Stripe here keeps the ledger honest about
        // who recorded what — nobody on the team should appear to have taken
        // a payment they never touched.
        recordedBy: "stripe",
        recordedByName: "Stripe",
        provider: "stripe",
        providerRef: payment.sessionId,
      };

      const payments = [...existing, entry];
      const amountPaid = sumPayments(payments);
      const total = typeof data.total === "number" ? data.total : 0;
      const status = statusAfterPayment(
        (data.status ?? "sent") as Parameters<typeof statusAfterPayment>[0],
        total,
        amountPaid,
      );

      tx.update(ref, {
        payments,
        amountPaid,
        balanceDue: Math.max(0, Number((total - amountPaid).toFixed(2))),
        status,
        ...(status === "paid" ? { settledAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "stripe",
        updatedByName: "Stripe",
      });

      return { recorded: true, duplicate: false, problem: "" };
    });
  } catch (error) {
    const problem = (error as Error).message;
    console.error(`Recording a card payment failed: ${problem}`);
    return { recorded: false, duplicate: false, problem };
  }
}
