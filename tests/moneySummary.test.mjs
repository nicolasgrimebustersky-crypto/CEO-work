/**
 * What actually came in.
 *
 * The Reports screen answers "how much work did we finish". This answers "how
 * much money did we take", and the gap between them is every job that was
 * completed and never paid for.
 *
 * The double-count test is the one that matters. A job can be marked paid *and*
 * carry an invoice recording the same payment; counting both inflates the year
 * silently, because the total just looks like a better year.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { grossFor, outstanding } = await import("../lib/money/summary.ts");

const at = (iso) => ({ toMillis: () => new Date(iso).getTime() });
const job = (id, price, paidAt) => ({ id, price, paidAt: paidAt ? at(paidAt) : null });
const invoice = (id, payments, jobId = null) => ({
  id,
  kind: "invoice",
  jobId,
  payments: payments.map(([amount, when]) => ({ amount, receivedAt: at(when) })),
});

const YEAR = 2026;

describe("money from jobs", () => {
  test("a job paid this year counts", () => {
    const gross = grossFor(YEAR, [job("j1", 450, "2026-03-04")], []);
    assert.equal(gross.fromJobs, 450);
    assert.equal(gross.total, 450);
    assert.equal(gross.jobCount, 1);
  });

  test("a job finished but never paid does not", () => {
    // This is the entire difference from the Reports figure.
    const gross = grossFor(YEAR, [job("j1", 450, null)], []);
    assert.equal(gross.total, 0);
    assert.equal(gross.jobCount, 0);
  });

  test("money is counted when it arrived, not when the work was done", () => {
    // December's work, January's money. A bank statement agrees.
    assert.equal(grossFor(2026, [job("j1", 450, "2026-01-04")], []).total, 450);
    assert.equal(grossFor(2025, [job("j1", 450, "2026-01-04")], []).total, 0);
  });

  test("last year's payments stay in last year", () => {
    const jobs = [job("j1", 100, "2025-12-31"), job("j2", 200, "2026-01-01")];
    assert.equal(grossFor(2026, jobs, []).total, 200);
    assert.equal(grossFor(2025, jobs, []).total, 100);
  });
});

describe("money from invoices", () => {
  test("each payment counts in the year it landed", () => {
    const gross = grossFor(YEAR, [], [invoice("d1", [[300, "2026-02-01"], [200, "2026-05-01"]])]);
    assert.equal(gross.fromInvoices, 500);
    assert.equal(gross.invoiceCount, 1);
  });

  test("a part payment counts for what was actually paid", () => {
    const gross = grossFor(YEAR, [], [invoice("d1", [[400, "2026-02-01"]])]);
    assert.equal(gross.total, 400);
  });

  test("payments spanning a year boundary split correctly", () => {
    const doc = invoice("d1", [[300, "2025-12-20"], [400, "2026-01-20"]]);
    assert.equal(grossFor(2026, [], [doc]).total, 400);
    assert.equal(grossFor(2025, [], [doc]).total, 300);
  });

  test("an estimate is not money", () => {
    // Somebody agreeing to a price is not somebody paying it.
    const estimate = { id: "e1", kind: "estimate", payments: [{ amount: 900, receivedAt: at("2026-04-01") }] };
    assert.equal(grossFor(YEAR, [], [estimate]).total, 0);
  });
});

describe("the double count", () => {
  test("a job invoiced and paid is counted once, through the invoice", () => {
    // The trap: both records describe the same money. Counting both reports
    // $900 for a $450 job, and nothing on screen would look wrong.
    const gross = grossFor(
      YEAR,
      [job("j1", 450, "2026-03-04")],
      [invoice("d1", [[450, "2026-03-04"]], "j1")],
    );
    assert.equal(gross.total, 450, "counted twice");
    assert.equal(gross.fromJobs, 0);
    assert.equal(gross.fromInvoices, 450);
  });

  test("a job with an unpaid invoice contributes nothing", () => {
    // The invoice says the money is outstanding. Trusting the job's own paidAt
    // would report revenue the invoice contradicts.
    const gross = grossFor(YEAR, [job("j1", 450, "2026-03-04")], [invoice("d1", [], "j1")]);
    assert.equal(gross.total, 0);
  });

  test("a job with no invoice still counts on its own", () => {
    const gross = grossFor(
      YEAR,
      [job("j1", 450, "2026-03-04"), job("j2", 300, "2026-03-05")],
      [invoice("d1", [[450, "2026-03-04"]], "j1")],
    );
    assert.equal(gross.fromJobs, 300);
    assert.equal(gross.fromInvoices, 450);
    assert.equal(gross.total, 750);
  });

  test("an invoice not tied to a job does not suppress anything", () => {
    const gross = grossFor(
      YEAR,
      [job("j1", 450, "2026-03-04")],
      [invoice("d1", [[100, "2026-03-04"]], null)],
    );
    assert.equal(gross.total, 550);
  });
});

describe("junk in the data", () => {
  test("nonsense amounts are ignored rather than added", () => {
    const jobs = [
      { id: "a", price: Number.NaN, paidAt: at("2026-01-01") },
      { id: "b", price: -100, paidAt: at("2026-01-01") },
      { id: "c", price: 0, paidAt: at("2026-01-01") },
      job("d", 50, "2026-01-01"),
    ];
    assert.equal(grossFor(YEAR, jobs, []).total, 50);
  });

  test("a missing or broken timestamp is not this year", () => {
    const jobs = [
      { id: "a", price: 100 },
      { id: "b", price: 100, paidAt: null },
      { id: "c", price: 100, paidAt: {} },
      { id: "d", price: 100, paidAt: { toMillis: () => Number.NaN } },
    ];
    assert.equal(grossFor(YEAR, jobs, []).total, 0);
  });

  test("nothing at all is zero, not an error", () => {
    const gross = grossFor(YEAR, [], []);
    assert.equal(gross.total, 0);
    assert.equal(gross.jobCount, 0);
    assert.equal(gross.invoiceCount, 0);
  });

  test("cents survive being added up", () => {
    const jobs = [job("a", 33.33, "2026-01-01"), job("b", 33.33, "2026-01-01"), job("c", 33.34, "2026-01-01")];
    assert.equal(grossFor(YEAR, jobs, []).total, 100);
  });
});

describe("what is still owed", () => {
  const totals = new Map([["d1", 500], ["d2", 300]]);

  test("an unpaid invoice is owed in full", () => {
    assert.equal(outstanding([invoice("d1", [])], totals), 500);
  });

  test("a part-paid invoice owes the rest", () => {
    assert.equal(outstanding([invoice("d1", [[200, "2026-01-01"]])], totals), 300);
  });

  test("a fully paid invoice owes nothing", () => {
    assert.equal(outstanding([invoice("d1", [[500, "2026-01-01"]])], totals), 0);
  });

  test("overpayment does not become a negative debt", () => {
    assert.equal(outstanding([invoice("d1", [[600, "2026-01-01"]])], totals), 0);
  });

  test("floating point does not invent a debt", () => {
    const cents = new Map([["d1", 0.3]]);
    const doc = invoice("d1", [[0.1, "2026-01-01"], [0.2, "2026-01-01"]]);
    assert.equal(outstanding([doc], cents), 0);
  });

  test("what is owed does not reset in January", () => {
    // Money owed from November is still owed. `outstanding` takes no year.
    assert.equal(outstanding([invoice("d1", [])], totals), 500);
  });
});
