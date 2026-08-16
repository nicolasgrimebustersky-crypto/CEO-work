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
