/**
 * Sales tax per filing period. Pinned: the periods and their due dates, that
 * drafts, estimates and void invoices never count, and that a partial payment
 * brings in its share of the tax.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { periodContaining, recentPeriods, taxByPeriod, asSalesTaxSettings } = await import("../lib/salesTax.ts");

const at = (y, m, d) => ({ toMillis: () => new Date(y, m - 1, d, 12).getTime() });
const inv = (over = {}) => ({
  kind: "invoice",
  status: "sent",
  issuedAt: at(2026, 5, 10),
  total: 106,
  taxAmount: 6,
  payments: [],
  ...over,
});

describe("filing periods", () => {
  test("monthly, quarterly and annual, each due the 20th of the month after", () => {
    const may = periodContaining(new Date(2026, 4, 17), "monthly");
    assert.equal(may.key, "2026-05");
    assert.equal(new Date(may.dueMs).toDateString(), new Date(2026, 5, 20).toDateString());
    const q2 = periodContaining(new Date(2026, 4, 17), "quarterly");
    assert.equal(q2.key, "2026-Q2");
    assert.equal(new Date(q2.dueMs).toDateString(), new Date(2026, 6, 20).toDateString());
    const year = periodContaining(new Date(2026, 4, 17), "annual");
    assert.equal(new Date(year.dueMs).toDateString(), new Date(2027, 0, 20).toDateString());
  });

  test("recent periods go back one at a time, across a year end", () => {
    const keys = recentPeriods(new Date(2026, 1, 3), "monthly", 3).map((p) => p.key);
    assert.deepEqual(keys, ["2026-02", "2026-01", "2025-12"]);
    assert.deepEqual(recentPeriods(new Date(2026, 1, 3), "quarterly", 2).map((p) => p.key), ["2026-Q1", "2025-Q4"]);
  });
});

describe("tax per period", () => {
  const may = periodContaining(new Date(2026, 4, 1), "monthly");
  const june = periodContaining(new Date(2026, 5, 1), "monthly");

  test("charged counts real invoices issued in the period only", () => {
    const [row] = taxByPeriod(
      [
        inv(),
        inv({ status: "draft" }),
        inv({ status: "void" }),
        inv({ kind: "estimate" }),
        inv({ issuedAt: at(2026, 6, 2) }),
        inv({ taxAmount: 0 }),
      ],
      [may],
    );
    assert.equal(row.charged, 6);
    assert.equal(row.invoiceCount, 1);
  });

  test("collected is the tax share of payments received in the period", () => {
    const rows = taxByPeriod(
      [inv({ status: "paid", payments: [{ amount: 53, receivedAt: at(2026, 5, 20) }, { amount: 53, receivedAt: at(2026, 6, 3) }] })],
      [may, june],
    );
    assert.equal(rows[0].collected, 3);
    assert.equal(rows[1].collected, 3);
    assert.equal(rows[1].charged, 0);
  });

  test("an overpayment never brings in more tax than the invoice carried", () => {
    const [row] = taxByPeriod([inv({ payments: [{ amount: 200, receivedAt: at(2026, 5, 20) }] })], [may]);
    assert.equal(row.collected, 6);
  });
});

describe("settings as stored", () => {
  const fallback = { enabled: true, permitNumber: "", filingFrequency: "monthly", defaultRatePct: 6 };
  test("missing or broken fields fall back one at a time", () => {
    assert.deepEqual(asSalesTaxSettings(null, fallback), fallback);
    const s = asSalesTaxSettings({ enabled: false, permitNumber: " 123-456 ", filingFrequency: "weekly", defaultRatePct: 99 }, fallback);
    assert.deepEqual(s, { enabled: false, permitNumber: "123-456", filingFrequency: "monthly", defaultRatePct: 6 });
  });
});
