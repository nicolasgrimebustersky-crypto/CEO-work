/**
 * The payments dashboard's figures.
 *
 * Dates are written in local time (no trailing Z) on purpose: the app buckets
 * by the owner's local day, and a test written in UTC fails on a laptop in
 * Kentucky for reasons that have nothing to do with the code.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { normalizeMethod, paymentEvents, collectedIn, byDay, byMethod, unpaidIn } = await import(
  "../lib/money/payments.ts"
);

const at = (local) => ({ toMillis: () => new Date(local).getTime() });
const ms = (local) => new Date(local).getTime();
const range = (from, to) => ({ startMs: ms(from), endMs: ms(to) });
const NOV = range("2026-11-01T00:00:00", "2026-12-01T00:00:00");

const job = (id, price, extra = {}) => ({ id, price, status: "complete", ...extra });
const invoice = (id, payments, extra = {}) => ({
  id,
  kind: "invoice",
  status: "paid",
  balanceDue: 0,
  payments: payments.map(([amount, when, method, provider]) => ({
    amount,
    receivedAt: at(when),
    method,
    provider,
  })),
  ...extra,
});

describe("reading a payment method", () => {
  test("free text lands in the right bucket", () => {
    assert.equal(normalizeMethod("Check 1042"), "Check");
    assert.equal(normalizeMethod("cash"), "Cash");
    assert.equal(normalizeMethod("Venmo @jay"), "Venmo");
    assert.equal(normalizeMethod("ZELLE"), "Zelle");
    assert.equal(normalizeMethod("Visa ending 4242"), "Card");
    assert.equal(normalizeMethod("", "stripe"), "Card");
    assert.equal(normalizeMethod("barter"), "Other");
    assert.equal(normalizeMethod(""), "Other");
  });
});

describe("payments collected", () => {
  const events = paymentEvents(
    [job("j1", 200, { paidAt: at("2026-11-03T10:00:00") }), job("j2", 999, { jobId: "x" })],
    [
      invoice("d1", [
        [300, "2026-11-05T15:00:00", "Card", "stripe"],
        [100, "2026-10-31T23:00:00", "Cash"],
      ]),
    ],
  );

  test("counts the period's payments from jobs and invoices", () => {
    assert.deepEqual(collectedIn(events, NOV), { total: 500, count: 2, average: 250 });
  });

  test("a job its invoice already covers is not counted twice", () => {
    const twice = paymentEvents(
      [job("j1", 300, { paidAt: at("2026-11-05T10:00:00") })],
      [invoice("d1", [[300, "2026-11-05T15:00:00", "Card"]], { jobId: "j1" })],
    );
    assert.equal(collectedIn(twice, NOV).total, 300);
  });

  test("nothing in the period is zero, not NaN", () => {
    assert.deepEqual(collectedIn([], NOV), { total: 0, count: 0, average: 0 });
  });
});

describe("money by day", () => {
  test("every day of the range is present, gaps included", () => {
    const events = paymentEvents([], [invoice("d1", [[50, "2026-11-02T22:30:00", "Cash"]])]);
    const days = byDay(events, NOV);
    assert.equal(days.length, 30);
    assert.equal(days[1].total, 50, "11pm on the 2nd is the 2nd");
    assert.equal(days[0].total + days[2].total, 0);
  });

  test("a year is grouped by week", () => {
    const year = range("2026-01-01T00:00:00", "2027-01-01T00:00:00");
    assert.ok(byDay([], year).length <= 53);
  });
});

describe("payment methods", () => {
  test("largest first, with shares that add up", () => {
    const events = paymentEvents(
      [],
      [
        invoice("d1", [
          [300, "2026-11-05T12:00:00", "Card"],
          [100, "2026-11-06T12:00:00", "Check 12"],
        ]),
      ],
    );
    const split = byMethod(events, NOV);
    assert.deepEqual(split.map((s) => [s.method, s.total]), [["Card", 300], ["Check", 100]]);
    assert.equal(split[0].share, 0.75);
  });
});

describe("what is still out", () => {
  const now = ms("2026-11-20T12:00:00");

  test("unpaid finished jobs as a share of the period's finished jobs", () => {
    const jobs = [
      job("a", 200, { completedAt: at("2026-11-03T12:00:00"), paidAt: at("2026-11-03T12:00:00") }),
      job("b", 300, { completedAt: at("2026-11-06T12:00:00") }),
      job("c", 0, { completedAt: at("2026-11-07T12:00:00"), visitType: "estimate" }),
    ];
    const unpaid = unpaidIn(jobs, [], NOV, now);
    assert.equal(unpaid.finishedJobs, 2, "an estimate visit is not billable work");
    assert.equal(unpaid.unpaidJobs, 1);
    assert.equal(unpaid.unpaidShare, 0.5);
    assert.equal(unpaid.balance, 300);
    assert.equal(unpaid.oldestDays, 14);
  });

  test("open invoices count toward the balance whenever they were raised", () => {
    const unpaid = unpaidIn(
      [],
      [
        invoice("d1", [], { status: "sent", balanceDue: 120, issuedAt: at("2026-09-01T12:00:00") }),
        invoice("d2", [], { status: "void", balanceDue: 500, issuedAt: at("2026-11-01T12:00:00") }),
      ],
      NOV,
      now,
    );
    assert.equal(unpaid.balance, 120);
    assert.equal(unpaid.oldestDays, 80);
  });

  test("an invoiced job's debt is counted once, through the invoice", () => {
    const unpaid = unpaidIn(
      [job("a", 300, { completedAt: at("2026-11-03T12:00:00") })],
      [invoice("d1", [], { status: "sent", balanceDue: 300, jobId: "a", issuedAt: at("2026-11-03T12:00:00") })],
      NOV,
      now,
    );
    assert.equal(unpaid.balance, 300);
    assert.equal(unpaid.unpaidJobs, 1);
  });

  test("nothing owed reads as nothing", () => {
    const unpaid = unpaidIn([], [], NOV, now);
    assert.equal(unpaid.balance, 0);
    assert.equal(unpaid.oldestDays, null);
    assert.equal(unpaid.unpaidShare, 0);
  });
});
