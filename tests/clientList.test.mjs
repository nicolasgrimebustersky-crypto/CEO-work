/**
 * The Clients list's derived figures.
 *
 * The one that matters is the paid percentage: a customer who overpaid or
 * paid an invoice that was later voided must not read as 130% paid, and a
 * customer with nothing invoiced must not divide by zero into NaN%.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  AVATAR_COLORS,
  avatarColor,
  clientMoney,
  isNewClient,
  invoiceCountLabel,
  NEW_CLIENT_DAYS,
} = await import("../lib/clientList.ts");

const doc = (kind, status, total, amountPaid = 0) => ({ kind, status, total, amountPaid });

describe("the disc colour", () => {
  test("is stable for the same name and comes from the palette", () => {
    assert.equal(avatarColor("Angela Foor"), avatarColor("Angela Foor"));
    assert.ok(AVATAR_COLORS.includes(avatarColor("Angela Foor")));
  });

  test("ignores case and surrounding space, which a typed name often has", () => {
    assert.equal(avatarColor("  angela foor "), avatarColor("Angela Foor"));
  });

  test("spreads different names across the palette", () => {
    const names = ["Angela Foor", "Becky Woo", "Bryan Romero", "Carry Hearn", "Christine McCloy", "Dev Castellano", "Ray Whitfield", "Priya Nolan"];
    const distinct = new Set(names.map(avatarColor));
    assert.ok(distinct.size >= 4, `only ${distinct.size} colours across ${names.length} names`);
  });
});

describe("what a client has been invoiced and paid", () => {
  test("estimates and void invoices do not count", () => {
    const money = clientMoney([
      doc("estimate", "sent", 900),
      doc("invoice", "void", 500, 500),
      doc("invoice", "paid", 300, 300),
    ]);
    assert.equal(money.invoiceCount, 1);
    assert.equal(money.invoiced, 300);
    assert.equal(money.paid, 300);
    assert.equal(money.paidPct, 100);
  });

  test("part paid is a whole-number percentage", () => {
    const money = clientMoney([doc("invoice", "partial", 742, 400)]);
    assert.equal(money.paidPct, 54);
  });

  test("nothing invoiced is 0%, not NaN", () => {
    const money = clientMoney([]);
    assert.equal(money.invoiced, 0);
    assert.equal(money.paidPct, 0);
    assert.equal(Number.isNaN(money.paidPct), false);
  });

  test("an overpayment never reads as more than fully paid", () => {
    const money = clientMoney([doc("invoice", "paid", 100, 120)]);
    assert.equal(money.paid, 100);
    assert.equal(money.paidPct, 100);
  });

  test("cents survive the sum", () => {
    const money = clientMoney([doc("invoice", "paid", 0.1, 0.1), doc("invoice", "paid", 0.2, 0.2)]);
    assert.equal(money.invoiced, 0.3);
  });
});

describe("who counts as new", () => {
  const now = Date.parse("2026-09-15T12:00:00Z");
  const day = 86_400_000;

  test("added this month with nothing invoiced", () => {
    assert.equal(isNewClient(now - 3 * day, 0, now), true);
  });

  test("not once they have an invoice, however recent", () => {
    assert.equal(isNewClient(now - 3 * day, 1, now), false);
  });

  test("not after the window", () => {
    assert.equal(isNewClient(now - (NEW_CLIENT_DAYS + 1) * day, 0, now), false);
    assert.equal(isNewClient(now - NEW_CLIENT_DAYS * day, 0, now), true);
  });
});

describe("the invoice count under the name", () => {
  test("reads as English", () => {
    assert.equal(invoiceCountLabel(0), "No invoices");
    assert.equal(invoiceCountLabel(1), "1 invoice");
    assert.equal(invoiceCountLabel(2), "2 invoices");
  });
});
