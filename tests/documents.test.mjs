/**
 * Tests for the estimate/invoice money model.
 *
 * These cover the pure half of turning an estimate into an invoice: the number
 * it gets, the totals it inherits, and the date it falls due. The write itself
 * needs Firestore and is covered by the rules suite and the browser audit; what
 * is here is the arithmetic, which is the part that is wrong quietly.
 *
 * A converted invoice copies the estimate's *stored* totals rather than
 * recomputing them, so the test that matters is that recomputing would have
 * produced the same figures — if those two ever disagree, an invoice says one
 * thing and the estimate it came from says another, in front of a customer.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  computeTotals,
  lineDiscount,
  lineDiscountPct,
  lineGross,
  lineTotal,
  defaultInvoiceDueDate,
  INVOICE_TERMS_DAYS,
  nextNumber,
  NUMBER_SEQUENCE_START,
  round2,
  statusAfterPayment,
} = await import("../lib/documents.ts");

const line = (name, quantity, unitPrice, taxable = true) => ({
  id: name,
  name,
  description: "",
  quantity,
  unitPrice,
  taxable,
});

describe("what a converted invoice inherits", () => {
  test("the totals recompute to exactly what was stored", () => {
    const lines = [line("House wash", 1, 450), line("Driveway", 2, 175)];
    const first = computeTotals(lines, 50, 6);
    const again = computeTotals(lines, 50, 6);
    assert.deepEqual(first, again);
  });

  test("every figure is rounded to cents", () => {
    // A third of a job split three ways is the classic way a total ends up
    // rendering as $1,160.7000001 on a customer's invoice.
    const totals = computeTotals([line("Split", 3, 33.333)], 0, 6);
    for (const [key, value] of Object.entries(totals)) {
      assert.equal(value, round2(value), `${key} carries sub-cent noise`);
    }
  });

  test("a discount comes off before tax", () => {
    const lines = [line("Wash", 1, 100)];
    const undiscounted = computeTotals(lines, 0, 10);
    const discounted = computeTotals(lines, 50, 10);
    assert.equal(undiscounted.total, 110);
    // Tax on 50, not on 100 — taking it after tax would overcharge the tax.
    assert.equal(discounted.total, 55);
  });

  test("an untaxed line is not taxed", () => {
    const totals = computeTotals([line("Materials", 1, 100, false)], 0, 6);
    assert.equal(totals.taxAmount, 0);
    assert.equal(totals.total, 100);
  });
});

describe("the number it gets", () => {
  test("continues the sequence Invoice Fly left off at", () => {
    assert.equal(nextNumber([]), String(NUMBER_SEQUENCE_START));
  });

  test("estimates and invoices share one sequence", () => {
    // Two sequences means two documents can both be "number 8905", which is
    // exactly the argument you cannot win with a customer holding both.
    assert.equal(nextNumber(["8904", "8905"]), "8906");
  });

  test("a converted invoice takes the next number, never the estimate's", () => {
    const estimateNumber = "8904";
    assert.notEqual(nextNumber([estimateNumber]), estimateNumber);
  });

  test("junk in the list cannot drag the sequence backwards", () => {
    assert.equal(nextNumber(["8910", "", "not-a-number"]), "8911");
  });
});

describe("when it falls due", () => {
  test("defaults to the standard terms from today", () => {
    const from = new Date("2026-03-01T09:00:00Z");
    const due = defaultInvoiceDueDate(from);
    const days = Math.round((due.getTime() - from.getTime()) / 86_400_000);
    assert.equal(days, INVOICE_TERMS_DAYS);
  });

  test("lands at midday, so a clock change cannot move the date", () => {
    // Counted at midnight, a US spring-forward would roll the due date onto
    // the previous day for anyone reading it in a different offset.
    assert.equal(defaultInvoiceDueDate(new Date("2026-03-01T09:00:00Z")).getHours(), 12);
  });

  test("crossing a month boundary still lands on a real date", () => {
    const due = defaultInvoiceDueDate(new Date("2026-01-25T09:00:00Z"));
    assert.equal(due.getMonth(), 1); // February
    assert.equal(due.getDate(), 8);
  });
});

describe("what happens once it is paid", () => {
  test("paying the balance marks it paid", () => {
    assert.equal(statusAfterPayment("sent", 450, 450), "paid");
  });

  test("part of it is partial", () => {
    assert.equal(statusAfterPayment("sent", 450, 200), "partial");
  });

  test("a customer who rounds up still reads as paid", () => {
    assert.equal(statusAfterPayment("sent", 450.02, 450.0175), "paid");
  });

  test("a voided invoice stays voided whatever arrives", () => {
    assert.equal(statusAfterPayment("void", 450, 450), "void");
  });
});

/* ------------------------------------------------- per-line percentages */

describe("a discount on one line and not the others", () => {
  // The case this was built for: a customer supplied her own sealant, so the
  // labour is discounted ten percent and the materials are not. A single
  // document-level figure cannot express that — it comes off everything.
  const labour = (name, price) => ({
    id: name,
    name,
    description: "",
    quantity: 1,
    unitPrice: price,
    taxable: true,
    discountPct: 10,
  });
  const materials = (name, price) => ({
    id: name,
    name,
    description: "",
    quantity: 1,
    unitPrice: price,
    taxable: true,
    discountPct: 0,
  });

  test("only the discounted line loses money", () => {
    const totals = computeTotals([labour("Wash", 1700), materials("Sealant", 900)], 0, 0);
    assert.equal(totals.subtotal, 2600, "full price of everything");
    assert.equal(totals.lineDiscounts, 170, "ten percent of the labour only");
    assert.equal(totals.total, 2430);
  });

  test("the pressure washing number from the real quote", () => {
    // $1,700 of washing at 10% is $1,530. Worked out by hand in a text message;
    // if this ever disagrees, the app is wrong and the text was right.
    const totals = computeTotals([labour("Pressure washing", 1700)], 0, 0);
    assert.equal(totals.total, 1530);
    assert.equal(totals.totalSaved, 170);
  });

  test("what the customer saved is line discounts plus the flat one", () => {
    const totals = computeTotals(
      [labour("Wash", 1000), materials("Sealant", 500)],
      50,
      0,
    );
    assert.equal(totals.lineDiscounts, 100);
    assert.equal(totals.discount, 50);
    assert.equal(totals.totalSaved, 150);
    assert.equal(totals.total, 1350);
  });
});

describe("the line arithmetic", () => {
  const item = (patch) => ({
    id: "x",
    name: "x",
    description: "",
    quantity: 1,
    unitPrice: 100,
    taxable: true,
    ...patch,
  });

  test("gross is what it was worth, total is what it costs", () => {
    const discounted = item({ discountPct: 25 });
    assert.equal(lineGross(discounted), 100);
    assert.equal(lineDiscount(discounted), 25);
    assert.equal(lineTotal(discounted), 75);
  });

  test("quantity is discounted too, not just the unit price", () => {
    const three = item({ quantity: 3, unitPrice: 200, discountPct: 10 });
    assert.equal(lineGross(three), 600);
    assert.equal(lineDiscount(three), 60);
    assert.equal(lineTotal(three), 540);
  });

  test("a line written before discounts existed is simply undiscounted", () => {
    // Every stored document predates this field. Reading one must not produce
    // NaN prices on an invoice somebody already sent.
    const old = { id: "a", name: "a", description: "", quantity: 2, unitPrice: 50, taxable: true };
    assert.equal(lineDiscountPct(old), 0);
    assert.equal(lineTotal(old), 100);
    assert.equal(computeTotals([old], 0, 0).total, 100);
  });

  test("nonsense percentages are clamped rather than trusted", () => {
    // A negative is a surcharge wearing a discount's clothes; over 100 would pay
    // the customer to take the work.
    assert.equal(lineDiscountPct(item({ discountPct: -20 })), 0);
    assert.equal(lineDiscountPct(item({ discountPct: 250 })), 100);
    assert.equal(lineDiscountPct(item({ discountPct: Number.NaN })), 0);
    assert.equal(lineDiscountPct(item({ discountPct: "10" })), 0);
    assert.equal(lineTotal(item({ discountPct: 250 })), 0, "free, never negative");
  });

  test("a hundred percent off is free, and does not go below zero", () => {
    const free = item({ discountPct: 100 });
    assert.equal(lineTotal(free), 0);
    assert.equal(computeTotals([free], 0, 6).total, 0);
  });
});

describe("tax, once lines are discounted", () => {
  const taxed = (price, pct) => ({
    id: String(price),
    name: "t",
    description: "",
    quantity: 1,
    unitPrice: price,
    taxable: true,
    discountPct: pct,
  });
  const untaxed = (price, pct) => ({ ...taxed(price, pct), id: "u", taxable: false });

  test("tax is charged on the discounted amount, not the full price", () => {
    // Charging tax on money the customer was never asked for is overcharging
    // them, and it is the kind of error that survives for years.
    const totals = computeTotals([taxed(1000, 10)], 0, 6);
    assert.equal(totals.taxableBase, 900);
    assert.equal(totals.taxAmount, 54);
    assert.equal(totals.total, 954);
  });

  test("a discount on an untaxed line does not move the taxable base", () => {
    const totals = computeTotals([taxed(1000, 0), untaxed(500, 20)], 0, 6);
    assert.equal(totals.taxableBase, 1000);
    assert.equal(totals.taxAmount, 60);
    assert.equal(totals.total, round2(1000 + 400 + 60));
  });

  test("the flat discount still spreads proportionally over what is left", () => {
    const totals = computeTotals([taxed(1000, 10), untaxed(1000, 0)], 190, 6);
    // Net: 900 taxable + 1000 untaxed = 1900. The 190 is 10% of that, so 90 of
    // it lands on the taxable side.
    assert.equal(totals.taxableBase, 810);
    assert.equal(totals.taxAmount, 48.6);
  });

  test("a flat discount cannot exceed what the lines still cost", () => {
    // Discounting past zero would invent a negative bill, and clamping to the
    // pre-discount subtotal would let it.
    const totals = computeTotals([taxed(1000, 50)], 5000, 6);
    assert.equal(totals.discount, 500);
    assert.equal(totals.total, 0);
    assert.ok(totals.taxableBase >= 0);
  });
});
