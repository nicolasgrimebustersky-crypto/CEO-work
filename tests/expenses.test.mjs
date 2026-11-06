/**
 * Expenses and the tax estimate built on them.
 *
 * The totals feed a number somebody sets money aside by, so the rules that
 * move it are pinned: meals count half, tax payments are not an expense, the
 * proof split adds up, and each tax is computed the way the IRS and Kentucky
 * compute it.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { expenseTotals, expenseProblem, parseAmount, knownAssets, isExpenseDate, localDate } =
  await import("../lib/expenses.ts");
const { estimateTax, atYearPace, nextEstimatedPaymentDue, taxYearFor } = await import(
  "../lib/taxEstimate.ts"
);

const e = (over = {}) => ({ date: "2026-05-04", amount: 50, category: "fuel", proof: "receipt", forWhat: "", ...over });

describe("expense totals", () => {
  test("only the asked-for year counts", () => {
    const t = expenseTotals([e(), e({ date: "2025-12-31" }), e({ date: "2027-01-01" })], 2026);
    assert.equal(t.spent, 50);
    assert.equal(t.count, 1);
  });

  test("meals count half against profit; tax payments are not an expense", () => {
    const t = expenseTotals(
      [e({ amount: 100 }), e({ category: "meals", amount: 40 }), e({ category: "tax_payment", amount: 900 })],
      2026,
    );
    assert.equal(t.spent, 140);
    assert.equal(t.deductible, 120);
    assert.equal(t.taxPaid, 900);
    assert.equal(t.byProof.receipt, 140);
  });

  test("the proof split adds up to what was spent", () => {
    const t = expenseTotals(
      [e({ amount: 10.1 }), e({ proof: "statement", amount: 20.2 }), e({ proof: "in_person", amount: 30.3 })],
      2026,
    );
    assert.equal(Math.round((t.byProof.receipt + t.byProof.statement + t.byProof.in_person) * 100) / 100, t.spent);
    assert.equal(t.byProof.in_person, 30.3);
  });

  test("categories are listed biggest first", () => {
    const t = expenseTotals([e({ amount: 5 }), e({ category: "equipment", amount: 2400 })], 2026);
    assert.deepEqual(t.byCategory.map((c) => c.category), ["equipment", "fuel"]);
  });

  test("zero, negative and broken amounts are ignored", () => {
    const t = expenseTotals([e({ amount: 0 }), e({ amount: -4 }), e({ amount: Number.NaN })], 2026);
    assert.equal(t.spent, 0);
    assert.equal(t.count, 0);
  });
});

describe("entering an expense", () => {
  test("amounts as people type them", () => {
    assert.equal(parseAmount("42.5"), 42.5);
    assert.equal(parseAmount("$1,200"), 1200);
    assert.equal(parseAmount(" 9.99 "), 9.99);
    assert.equal(parseAmount("0"), null);
    assert.equal(parseAmount("12.345"), null);
    assert.equal(parseAmount("abc"), null);
  });

  test("a receipt expense needs the receipt", () => {
    const fields = {
      date: "2026-05-04", amount: 20, category: "tools", vendor: "", forWhat: "",
      paymentMethod: "cash", proof: "receipt", notes: "", receipt: null,
    };
    assert.match(expenseProblem(fields), /receipt/i);
    assert.equal(expenseProblem({ ...fields, proof: "in_person" }), null);
    assert.equal(expenseProblem({ ...fields, receipt: { url: "u", path: "p", contentType: "image/jpeg" } }), null);
    assert.match(expenseProblem({ ...fields, date: "2026-02-30", proof: "in_person" }), /day/);
  });

  test("calendar days are real days", () => {
    assert.equal(isExpenseDate("2026-02-28"), true);
    assert.equal(isExpenseDate("2026-02-29"), false);
    assert.equal(isExpenseDate("2026-5-4"), false);
    assert.equal(localDate(new Date(2026, 0, 9, 23, 30)), "2026-01-09");
  });

  test("the 'for' picker learns from history, most used first, one spelling each", () => {
    const list = knownAssets([
      e({ forWhat: "Zero-turn" }),
      e({ forWhat: "zero-turn" }),
      e({ forWhat: "F-150" }),
      e({ forWhat: "truck" }),
    ]);
    assert.equal(list[0], "Zero-turn");
    assert.ok(list.includes("F-150"));
    // "truck" was learned, so the built-in "Truck" is not added again.
    assert.equal(list.filter((a) => a.toLowerCase() === "truck").length, 1);
  });
});

describe("tax estimate", () => {
  const single = { year: 2026, filing: "single" };

  test("no profit, no tax", () => {
    const t = estimateTax(0, single);
    assert.equal(t.total, 0);
    assert.equal(estimateTax(-5000, single).total, 0);
  });

  test("$40,000 profit, single, worked by hand", () => {
    // SE base 36,940; SE tax 15.3% = 5,651.82; half 2,825.91
    // AGI 37,174.09; less 16,100 = 21,074.09; QBI 20% = 4,214.82; taxable 16,859.27
    // Federal: 1,240 + 12% × 4,459.27 = 1,775.11
    // Kentucky: 3.5% × (37,174.09 − 3,360) = 1,183.49
    const t = estimateTax(40_000, single);
    assert.equal(t.selfEmploymentTax, 5651.82);
    assert.equal(t.federalIncomeTax, 1775.11);
    assert.equal(t.kentuckyIncomeTax, 1183.49);
    assert.equal(t.total, 8610.42);
    assert.ok(t.effectiveRate > 0.21 && t.effectiveRate < 0.22);
  });

  test("filing jointly doubles the deduction and brackets", () => {
    assert.ok(estimateTax(40_000, { year: 2026, filing: "joint" }).federalIncomeTax < 1775.11);
  });

  test("under $433 of profit there is no self-employment tax", () => {
    assert.equal(estimateTax(430, single).selfEmploymentTax, 0);
    assert.ok(estimateTax(440, single).selfEmploymentTax > 0);
  });

  test("Social Security stops at the wage base", () => {
    const a = estimateTax(300_000, single).selfEmploymentTax;
    const b = estimateTax(310_000, single).selfEmploymentTax;
    // Above the base only Medicare (2.9% + 0.9%) of 92.35% grows.
    assert.ok(Math.abs(b - a - 10_000 * 0.9235 * 0.038) < 0.02);
  });

  test("a local occupational tax is applied to profit when given", () => {
    assert.equal(estimateTax(40_000, { ...single, localRate: 0.022 }).localTax, 880);
    assert.equal(estimateTax(40_000, { ...single, localRate: 5 }).localTax, 4000); // capped at 10%
  });

  test("a year with no figures yet uses the latest known year's", () => {
    assert.equal(taxYearFor(2026).exact, true);
    const later = taxYearFor(2030);
    assert.equal(later.exact, false);
    assert.equal(later.figures.year, 2026);
  });

  test("the year's pace", () => {
    // Halfway through a non-leap year (2 July, roughly): twice what came in.
    const mid = new Date(2026, 6, 2, 12);
    const projected = atYearPace(10_000, 2026, mid);
    assert.ok(projected > 19_900 && projected < 20_100);
    assert.equal(atYearPace(10_000, 2025, mid), 10_000);
  });

  test("the next estimated payment date", () => {
    assert.deepEqual(
      ((d) => [d.date.getMonth(), d.date.getDate(), d.quarter, d.taxYear])(nextEstimatedPaymentDue(new Date(2026, 10, 5))),
      [0, 15, 4, 2026],
    );
    assert.equal(nextEstimatedPaymentDue(new Date(2026, 3, 15)).quarter, 1);
    assert.equal(nextEstimatedPaymentDue(new Date(2026, 3, 16)).quarter, 2);
    assert.equal(nextEstimatedPaymentDue(new Date(2026, 0, 10)).taxYear, 2025);
  });
});
