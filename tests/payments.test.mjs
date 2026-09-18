/**
 * Card payments, the pure half.
 *
 * Three things here are worth a test and none of them are cosmetic. The
 * dollars-to-cents conversion is the one that can charge somebody the wrong
 * amount, and it is wrong in exactly the cases floating point is wrong in, so
 * it is tested on those. The config read decides whether the button appears at
 * all, and a half-configured deployment must fail closed rather than take money
 * it cannot record. The webhook reader parses a body from the open internet:
 * the signature check upstream proves Stripe sent it, not that it has the shape
 * this code expects, so every field is treated as hostile.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  readStripeConfig,
  canTakeCardPayments,
  cardPaymentsHint,
  toMinorUnits,
  fromMinorUnits,
  checkPayable,
  readWebhookPayment,
  cardPaymentMethod,
  MIN_CHARGE_CENTS,
  PAID_EVENT,
} = await import("../lib/payments.ts");

const { round2, OPEN_INVOICE_STATUSES } = await import("../lib/documents.ts");

const FULL_ENV = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  NEXT_PUBLIC_SITE_URL: "https://crm.example.com",
};

describe("reading the configuration", () => {
  test("a fully set environment can take payments", () => {
    const config = readStripeConfig(FULL_ENV);
    assert.equal(canTakeCardPayments(config), true);
    assert.equal(cardPaymentsHint(config), "");
  });

  test("a trailing slash on the site URL is dropped, so return URLs don't double up", () => {
    const config = readStripeConfig({ ...FULL_ENV, NEXT_PUBLIC_SITE_URL: "https://crm.example.com///" });
    assert.equal(config.siteUrl, "https://crm.example.com");
  });

  test("a relative site URL is treated as unset rather than passed to Stripe", () => {
    const config = readStripeConfig({ ...FULL_ENV, NEXT_PUBLIC_SITE_URL: "/crm" });
    assert.equal(config.siteUrl, "");
    assert.equal(canTakeCardPayments(config), false);
  });

  test("a secret key with no webhook secret fails closed", () => {
    // The dangerous half-configuration: money could be taken and never recorded.
    const config = readStripeConfig({ ...FULL_ENV, STRIPE_WEBHOOK_SECRET: "" });
    assert.equal(canTakeCardPayments(config), false);
    assert.match(cardPaymentsHint(config), /STRIPE_WEBHOOK_SECRET/);
  });

  test("an empty environment names everything that is missing", () => {
    const hint = cardPaymentsHint(readStripeConfig({}));
    assert.match(hint, /STRIPE_SECRET_KEY/);
    assert.match(hint, /STRIPE_WEBHOOK_SECRET/);
    assert.match(hint, /NEXT_PUBLIC_SITE_URL/);
  });

  test("whitespace around a key does not count as a key", () => {
    assert.equal(readStripeConfig({ ...FULL_ENV, STRIPE_SECRET_KEY: "   " }).secretKey, "");
  });
});

describe("dollars to cents, where a rounding error is somebody's money", () => {
  test("the floating-point cases that naive rounding gets wrong", () => {
    // 420.15 * 100 is 42014.999999999996 in binary floating point.
    assert.equal(toMinorUnits(420.15), 42015);
    assert.equal(toMinorUnits(1.005), 101);
    assert.equal(toMinorUnits(2.675), 268);
    assert.equal(toMinorUnits(1.1), 110);
    assert.equal(toMinorUnits(0.29), 29);
  });

  test("the charge always matches the total the invoice displays", () => {
    // The invariant that matters, and the one that is easy to break later:
    // every total in the app is rounded with round2, so if these two ever
    // disagree the customer is charged a different number than they are
    // shown. (1.005) is the case that catches it — round2 gives 1.01 while
    // toFixed-based rounding gives 1.00.
    const amounts = [0.5, 1.005, 1.1, 2.675, 19.99, 420.15, 1234.565, 9999.99];
    for (const amount of amounts) {
      assert.equal(
        toMinorUnits(amount),
        Math.round(round2(amount) * 100),
        `charge for ${amount} must equal its displayed total`,
      );
    }
  });

  test("ordinary amounts", () => {
    assert.equal(toMinorUnits(0), 0);
    assert.equal(toMinorUnits(1), 100);
    assert.equal(toMinorUnits(420), 42000);
  });

  test("a negative or non-finite amount throws instead of charging something", () => {
    assert.throws(() => toMinorUnits(-1), /negative/);
    assert.throws(() => toMinorUnits(Number.NaN), /not a number/);
    assert.throws(() => toMinorUnits(Number.POSITIVE_INFINITY), /not a number/);
    assert.throws(() => toMinorUnits(1e15), /too large/);
  });

  test("cents back to dollars round-trips", () => {
    // round2, not toFixed, is the oracle: toFixed is the rounding this module
    // deliberately does not use, so 2.675 round-trips to 2.68 and not 2.67.
    for (const amount of [0.5, 1.1, 2.675, 420.15, 9999.99]) {
      assert.equal(fromMinorUnits(toMinorUnits(amount)), round2(amount));
    }
  });
});

describe("what can actually be paid", () => {
  const invoice = { kind: "invoice", status: "sent", balanceDue: 420.15 };

  test("an open invoice with a balance", () => {
    assert.equal(checkPayable(invoice).payable, true);
  });

  test("an estimate cannot be paid — there is nothing owed on a proposal", () => {
    const result = checkPayable({ ...invoice, kind: "estimate" });
    assert.equal(result.payable, false);
    assert.match(result.reason, /invoice/i);
  });

  test("a settled invoice is refused, so nobody pays twice", () => {
    const result = checkPayable({ ...invoice, balanceDue: 0 });
    assert.equal(result.payable, false);
    assert.match(result.reason, /paid in full/i);
  });

  test("a voided invoice is refused", () => {
    assert.equal(checkPayable({ ...invoice, status: "void" }).payable, false);
  });

  test("a draft invoice is refused — a share link can be copied off one", () => {
    // ensureShareToken puts no status restriction on sharing, so a crew member
    // who taps Copy link on a half-finished invoice must not hand the customer
    // a live Pay button for a price nobody finished deciding.
    const result = checkPayable({ ...invoice, status: "draft" });
    assert.equal(result.payable, false);
    assert.match(result.reason, /isn't ready/i);
  });

  test("payable status agrees with the app's own OPEN_INVOICE_STATUSES", () => {
    // Two definitions of "an open invoice" would drift. This pins them.
    for (const status of ["draft", "sent", "partial", "paid", "void", "accepted", "declined"]) {
      assert.equal(
        checkPayable({ ...invoice, status }).payable,
        OPEN_INVOICE_STATUSES.includes(status),
        `status ${status}`,
      );
    }
  });

  test("a balance under Stripe's floor is refused here, not by a broken button", () => {
    const result = checkPayable({ ...invoice, balanceDue: 0.25 });
    assert.equal(result.payable, false);
    assert.match(result.reason, /minimum/i);
    assert.equal(checkPayable({ ...invoice, balanceDue: MIN_CHARGE_CENTS / 100 }).payable, true);
  });

  test("an overpaid invoice reads as paid, not as a negative charge", () => {
    assert.equal(checkPayable({ ...invoice, balanceDue: -10 }).payable, false);
  });
});

describe("reading a webhook, which arrives from the open internet", () => {
  const good = {
    type: PAID_EVENT,
    data: {
      object: {
        id: "cs_test_123",
        amount_total: 42015,
        payment_status: "paid",
        metadata: { documentId: "doc_1", orgId: "org_1" },
      },
    },
  };

  test("a completed, paid session becomes a payment", () => {
    assert.deepEqual(readWebhookPayment(good), {
      sessionId: "cs_test_123",
      documentId: "doc_1",
      orgId: "org_1",
      amount: 420.15,
      paid: true,
    });
  });

  test("a completed but unpaid session is read, and marked unpaid", () => {
    const event = structuredClone(good);
    event.data.object.payment_status = "unpaid";
    assert.equal(readWebhookPayment(event).paid, false);
  });

  test("every other event type is ignored rather than half-handled", () => {
    for (const type of ["payment_intent.succeeded", "charge.refunded", "invoice.paid", ""]) {
      assert.equal(readWebhookPayment({ ...good, type }), null);
    }
  });

  test("a body missing the metadata we set is refused", () => {
    for (const metadata of [undefined, null, {}, { documentId: "doc_1" }, { orgId: "org_1" }]) {
      const event = structuredClone(good);
      event.data.object.metadata = metadata;
      assert.equal(readWebhookPayment(event), null);
    }
  });

  test("a non-numeric or missing amount is refused, never coerced", () => {
    for (const amount of ["42015", null, undefined, {}]) {
      const event = structuredClone(good);
      event.data.object.amount_total = amount;
      assert.equal(readWebhookPayment(event), null);
    }
  });

  test("a zero or negative amount is refused", () => {
    for (const amount of [0, -100]) {
      const event = structuredClone(good);
      event.data.object.amount_total = amount;
      assert.equal(readWebhookPayment(event), null);
    }
  });

  test("garbage does not throw", () => {
    for (const event of [null, undefined, "", 0, [], {}, { type: PAID_EVENT }, { type: PAID_EVENT, data: {} }]) {
      assert.equal(readWebhookPayment(event), null);
    }
  });
});

describe("how a card payment reads in the ledger", () => {
  test("the last four are kept, because that is what reconciles a statement", () => {
    assert.equal(cardPaymentMethod("4242"), "Card ••4242");
  });

  test("a full number is never stored — only its last four survive", () => {
    assert.equal(cardPaymentMethod("4242424242424242"), "Card ••4242");
  });

  test("anything unusable degrades to a plain label", () => {
    for (const value of ["", "12", "abcd"]) {
      assert.equal(cardPaymentMethod(value), "Card");
    }
  });
});
