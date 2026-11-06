/**
 * The year-end packet: Schedule C lines, contractors at the 1099 threshold,
 * and a CSV that opens safely in a spreadsheet.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { buildPacket, packetCsv, contractorThreshold, scheduleCLine, csvCell } = await import("../lib/cpaPacket.ts");

const e = (over = {}) => ({
  id: "e1",
  date: "2026-05-04",
  amount: 100,
  category: "supplies",
  vendor: "Home Depot",
  forWhat: "",
  paymentMethod: "card",
  proof: "receipt",
  notes: "",
  createdByName: "Owner",
  receiptUrl: null,
  ...over,
});
const base = { year: 2026, grossReceipts: 50_000, trips: [], salesTax: { charged: 600, collected: 540 }, mileageMethod: "standard" };

describe("Schedule C lines", () => {
  test("categories land on their lines; meals count half; tax payments are not expenses", () => {
    const p = buildPacket({
      ...base,
      expenses: [
        e({ category: "supplies", amount: 100 }),
        e({ category: "tools", amount: 50 }),
        e({ category: "meals", amount: 40 }),
        e({ category: "equipment", amount: 2400 }),
        e({ category: "tax_payment", amount: 900, vendor: "IRS" }),
        e({ category: "sales_tax_remitted", amount: 500, vendor: "Kentucky DOR" }),
        e({ date: "2025-12-31", amount: 999 }),
      ],
    });
    const line = (n) => p.lines.find((l) => l.line === n)?.amount ?? 0;
    assert.equal(line("1"), 50000);
    assert.equal(line("22"), 150);
    assert.equal(line("24b"), 20);
    assert.equal(line("13"), 2400);
    assert.equal(line("23"), 500); // sales tax paid to the state
    assert.equal(p.estimatedPaid, 900);
    assert.equal(p.totalExpenses, 3070);
    assert.equal(p.netProfit, 46930);
  });

  test("standard mileage replaces gas and truck upkeep on line 9; actual uses them", () => {
    const expenses = [e({ category: "fuel", amount: 300 }), e({ category: "vehicle", amount: 200 })];
    const trips = [{ date: "2026-05-04", miles: 100, reason: "x", createdByName: "R", estimated: false, value: 72.5 }];
    const std = buildPacket({ ...base, expenses, trips });
    assert.equal(std.lines.find((l) => l.line === "9").amount, 72.5);
    const actual = buildPacket({ ...base, expenses, trips, mileageMethod: "actual" });
    assert.equal(actual.lines.find((l) => l.line === "9").amount, 500);
    assert.equal(scheduleCLine("fuel", "standard"), null);
  });

  test("paperless spending is totalled for the accountant", () => {
    const p = buildPacket({ ...base, expenses: [e({ proof: "in_person", amount: 75 }), e({ proof: "statement", amount: 25 })] });
    assert.equal(p.paperless, 75);
  });
});

describe("contractors and 1099s", () => {
  test("the threshold is $600 before 2026 and $2,000 for 2026", () => {
    assert.equal(contractorThreshold(2025), 600);
    assert.equal(contractorThreshold(2026), 2000);
  });

  test("payments group by name, case-insensitively, and flag at the threshold", () => {
    const p = buildPacket({
      ...base,
      expenses: [
        e({ category: "labor", vendor: "Jake Miller", amount: 1500 }),
        e({ category: "labor", vendor: "jake miller", amount: 500 }),
        e({ category: "labor", vendor: "Sam", amount: 300 }),
      ],
    });
    assert.deepEqual(
      p.contractors.map((c) => [c.name, c.paid, c.needs1099]),
      [
        ["Jake Miller", 2000, true],
        ["Sam", 300, false],
      ],
    );
  });
});

describe("the CSV", () => {
  test("quotes commas and quotes, and defuses spreadsheet formulas", () => {
    assert.equal(csvCell('Smith, "Bob"'), '"Smith, ""Bob"""');
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell(-5), "-5"); // numbers are numbers
  });

  test("has every section", () => {
    const csv = packetCsv(buildPacket({ ...base, expenses: [e()] }), "Example Co LLC");
    for (const h of ["PROFIT AND LOSS", "EXPENSES", "MILEAGE LOG", "SALES TAX", "CONTRACTORS", "ESTIMATED TAX PAYMENTS"]) {
      assert.ok(csv.includes(h), h);
    }
  });
});
