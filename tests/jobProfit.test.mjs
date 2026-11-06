/**
 * Profit per job and per client, worked by hand so a change in the costing
 * shows up as a failed number, not a quietly different screen.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { jobProfits, clientProfits, asProfitSettings, PROFIT_DEFAULTS } = await import("../lib/jobProfit.ts");

const H = 3_600_000;
const base = new Date(2026, 4, 4, 9).getTime();
const job = (over = {}) => ({
  id: "j1",
  customerId: "c1",
  price: 100,
  assignedTo: ["alice"],
  scheduledStartMs: base,
  scheduledEndMs: base + H,
  startedMs: null,
  finishedMs: null,
  lat: 38.4,
  lng: -85.4,
  ...over,
});
const settings = { laborRatePerHour: 20, ratesByUid: {}, costPerMile: 0.5, targetMarginPct: 30 };

describe("profit on a job", () => {
  test("booked hour, one person, no drive, no costs: price minus an hour's labour", () => {
    const [p] = jobProfits([job()], [], [], settings);
    assert.equal(p.labor, 20);
    assert.equal(p.profit, 80);
    assert.equal(p.margin, 0.8);
  });

  test("real Start/Finish taps beat the booking; two people cost twice", () => {
    const [p] = jobProfits([job({ startedMs: base, finishedMs: base + 2 * H, assignedTo: ["alice", "bob"] })], [], [], settings);
    assert.equal(p.onSiteHours, 2);
    assert.equal(p.labor, 80);
  });

  test("a per-person rate overrides the default", () => {
    const [p] = jobProfits([job()], [], [], { ...settings, ratesByUid: { alice: 30 } });
    assert.equal(p.labor, 30);
  });

  test("a logged trip into the job adds drive time and mileage", () => {
    const [p] = jobProfits([job()], [{ miles: 16, jobIds: ["j0", "j1"] }], [], settings);
    assert.equal(p.miles, 16);
    assert.equal(p.driveHours, 0.5); // 16 mi at 32 mph
    assert.equal(p.mileage, 8);
    assert.equal(p.labor, 30); // 1.5 h × $20
  });

  test("without a trip, the drive is estimated from the same person's previous job that day", () => {
    const a = job({ id: "a", startedMs: base, finishedMs: base + H });
    const b = job({ id: "b", lat: 38.5, startedMs: base + 2 * H, finishedMs: base + 3 * H });
    const ps = jobProfits([b, a], [], [], settings);
    assert.equal(ps.find((p) => p.jobId === "a").miles, 0);
    assert.ok(ps.find((p) => p.jobId === "b").miles > 9);
  });

  test("the month's fuel and supplies are spread by hours on site", () => {
    const a = job({ id: "a" }); // 1 h
    const b = job({ id: "b", scheduledEndMs: base + 3 * H }); // 3 h
    const ps = jobProfits([a, b], [], [{ date: "2026-05-10", amount: 40 }, { date: "2026-06-01", amount: 999 }], settings);
    assert.equal(ps.find((p) => p.jobId === "a").allocated, 10);
    assert.equal(ps.find((p) => p.jobId === "b").allocated, 30);
  });
});

describe("profit per client", () => {
  test("least profitable first, with a price that would reach the target margin", () => {
    const jobs = jobProfits(
      [
        job({ id: "x1", customerId: "cheap", price: 30 }),
        job({ id: "x2", customerId: "cheap", price: 30 }),
        job({ id: "y1", customerId: "good", price: 100 }),
      ],
      [],
      [],
      settings,
    );
    const clients = clientProfits(jobs, 30);
    assert.equal(clients[0].customerId, "cheap");
    // Cost $20 a visit; 30% margin needs 20 / 0.7 = 28.57, but they already pay 30.
    assert.equal(clients[0].suggestedPrice, null);
    const tight = clientProfits(jobs, 50); // needs 40 a visit
    assert.equal(tight[0].suggestedPrice, 40);
    assert.equal(clients.find((c) => c.customerId === "good").suggestedPrice, null);
  });
});

describe("stored settings", () => {
  test("bad values fall back; per-person rates are kept only when sane", () => {
    const s = asProfitSettings({ laborRatePerHour: -1, costPerMile: "x", targetMarginPct: 120, ratesByUid: { a: 22, b: -5, c: "9" } });
    assert.equal(s.laborRatePerHour, PROFIT_DEFAULTS.laborRatePerHour);
    assert.equal(s.costPerMile, PROFIT_DEFAULTS.costPerMile);
    assert.equal(s.targetMarginPct, PROFIT_DEFAULTS.targetMarginPct);
    assert.deepEqual(s.ratesByUid, { a: 22 });
  });
});
