/**
 * The month cards on the Money screen.
 *
 * What is worth testing here is the boundaries — a document issued at one
 * minute past midnight on the first belongs to the new month, not the old —
 * and the arithmetic that turns two months into an arrow and a percentage.
 * A card that says "up 29%" when the month was down is worse than no card.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  monthPeriod,
  yearPeriod,
  previousPeriod,
  inPeriod,
  documentsIn,
  periodTotal,
  periodsFor,
  periodCards,
  percentChange,
  balanceDueIn,
  pendingIn,
  compactMoney,
  formatChange,
} = await import("../lib/documentPeriods.ts");

const stamp = (y, m, d, h = 12) => ({ toMillis: () => new Date(y, m, d, h).getTime() });

const doc = (kind, status, total, issuedAt, balanceDue = 0) => ({
  kind,
  status,
  total,
  balanceDue,
  issuedAt,
});

const NOW = new Date(2026, 8, 15, 10); // 15 September 2026

describe("which month a document belongs to", () => {
  test("one minute past midnight on the first is the new month", () => {
    const march = monthPeriod(2026, 2);
    assert.equal(inPeriod(doc("invoice", "sent", 1, stamp(2026, 2, 1, 0)), march), true);
    assert.equal(inPeriod(doc("invoice", "sent", 1, stamp(2026, 1, 28, 23)), march), false);
  });

  test("the last moment of the month is still the month", () => {
    const march = monthPeriod(2026, 2);
    const lastMs = { toMillis: () => new Date(2026, 3, 1).getTime() - 1 };
    assert.equal(inPeriod(doc("invoice", "sent", 1, lastMs), march), true);
    assert.equal(inPeriod(doc("invoice", "sent", 1, stamp(2026, 3, 1, 0)), march), false);
  });

  test("december's previous month is november and january's is december of last year", () => {
    assert.equal(previousPeriod(monthPeriod(2026, 11)).key, "2026-11");
    assert.equal(previousPeriod(monthPeriod(2026, 0)).key, "2025-12");
    assert.equal(previousPeriod(yearPeriod(2026)).key, "2025");
  });

  test("a document with no issue date is in no period", () => {
    assert.equal(inPeriod(doc("invoice", "sent", 1, null), yearPeriod(2026)), false);
  });

  test("labels read as a person would say them", () => {
    assert.equal(monthPeriod(2026, 2).label, "Mar 2026");
    assert.equal(monthPeriod(2026, 2).heading, "March 2026");
    assert.equal(yearPeriod(2026).label, "2026");
    assert.equal(yearPeriod(2026).heading, "Total 2026");
  });
});

describe("what a period adds up to", () => {
  const docs = [
    doc("invoice", "paid", 100, stamp(2026, 2, 3)),
    doc("invoice", "sent", 250, stamp(2026, 2, 20), 250),
    doc("invoice", "void", 999, stamp(2026, 2, 21)),
    doc("estimate", "sent", 400, stamp(2026, 2, 9)),
    doc("invoice", "paid", 75, stamp(2026, 3, 1)),
  ];

  test("only that kind, only that month, never a void", () => {
    assert.equal(periodTotal(docs, monthPeriod(2026, 2), "invoice"), 350);
    assert.equal(periodTotal(docs, monthPeriod(2026, 2), "estimate"), 400);
    assert.equal(documentsIn(docs, monthPeriod(2026, 2), "invoice").length, 2);
  });

  test("the year card is everything", () => {
    assert.equal(periodTotal(docs, yearPeriod(2026), "invoice"), 425);
  });

  test("the balance due is what is still owed on that month's invoices", () => {
    assert.equal(balanceDueIn(docs, monthPeriod(2026, 2)), 250);
    assert.equal(balanceDueIn(docs, monthPeriod(2026, 3)), 0);
  });

  test("pending is the estimates nobody has answered", () => {
    const withAnswers = [
      ...docs,
      doc("estimate", "accepted", 900, stamp(2026, 2, 10)),
      doc("estimate", "draft", 50, stamp(2026, 2, 11)),
    ];
    assert.equal(pendingIn(withAnswers, monthPeriod(2026, 2)), 450);
  });

  test("cents survive the sum", () => {
    const cents = [
      doc("invoice", "paid", 0.1, stamp(2026, 2, 3)),
      doc("invoice", "paid", 0.2, stamp(2026, 2, 4)),
    ];
    assert.equal(periodTotal(cents, monthPeriod(2026, 2), "invoice"), 0.3);
  });
});

describe("which periods get a card", () => {
  test("a new book still shows six months, ending on this one", () => {
    const periods = periodsFor([], "invoice", NOW);
    assert.deepEqual(
      periods.map((p) => p.key),
      ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026"],
    );
  });

  test("an old document pulls the row back to its month", () => {
    const docs = [doc("invoice", "paid", 10, stamp(2026, 0, 5))];
    const periods = periodsFor(docs, "invoice", NOW);
    assert.equal(periods[0].key, "2026-01");
    assert.equal(periods.at(-1).key, "2026");
    assert.equal(periods.length, 10);
  });

  test("but never further back than twelve months", () => {
    const docs = [doc("invoice", "paid", 10, stamp(2023, 0, 5))];
    const periods = periodsFor(docs, "invoice", NOW);
    assert.equal(periods.length, 13);
    assert.equal(periods[0].key, "2025-10");
  });

  test("the other kind's history does not stretch this kind's row", () => {
    const docs = [doc("estimate", "sent", 10, stamp(2026, 0, 5))];
    assert.equal(periodsFor(docs, "invoice", NOW).length, 7);
  });
});

describe("the arrow on each card", () => {
  test("up, down, and flat", () => {
    assert.equal(percentChange(100, 129), 29);
    assert.equal(percentChange(100, 11), -89);
    assert.equal(percentChange(100, 100), 0);
  });

  test("from nothing is not a percentage", () => {
    assert.equal(percentChange(0, 500), null);
    assert.equal(formatChange(null), "—");
  });

  test("small changes keep a decimal, big ones do not", () => {
    assert.equal(formatChange(2.5), "2.5%");
    assert.equal(formatChange(-204.4), "204%");
  });

  test("each card compares to the month before it, including one off the row", () => {
    const docs = [
      doc("invoice", "paid", 100, stamp(2026, 2, 3)), // March — before the row starts
      doc("invoice", "paid", 300, stamp(2026, 3, 3)), // April
      doc("invoice", "paid", 150, stamp(2026, 4, 3)), // May
    ];
    const cards = periodCards(docs, "invoice", NOW);
    const byKey = Object.fromEntries(cards.map((c) => [c.period.key, c]));
    assert.equal(byKey["2026-04"].total, 300);
    assert.equal(byKey["2026-04"].changePct, 200); // against March, which has no card
    assert.equal(byKey["2026-05"].changePct, -50);
    assert.equal(byKey["2026-06"].changePct, -100);
    assert.equal(byKey["2026-07"].changePct, null);
    assert.equal(byKey["2026"].total, 550);
    assert.equal(byKey["2026"].changePct, null); // 2025 was empty
    assert.equal(byKey["2026-04"].count, 1);
  });
});

describe("a figure that fits on a card", () => {
  test("whole dollars under a thousand", () => {
    assert.equal(compactMoney(652), "$652");
    assert.equal(compactMoney(149.5), "$150");
    assert.equal(compactMoney(0), "$0");
  });

  test("three significant digits with a K", () => {
    assert.equal(compactMoney(4621.6), "$4.62K");
    assert.equal(compactMoney(9141.7), "$9.14K");
    assert.equal(compactMoney(12_345), "$12.3K");
    assert.equal(compactMoney(123_456), "$123K");
  });

  test("a round thousand does not carry dead zeros", () => {
    assert.equal(compactMoney(5000), "$5K");
    assert.equal(compactMoney(5100), "$5.1K");
  });

  test("millions, should the day come", () => {
    assert.equal(compactMoney(1_234_567), "$1.23M");
  });

  test("a negative keeps its sign", () => {
    assert.equal(compactMoney(-2500), "-$2.5K");
  });
});
