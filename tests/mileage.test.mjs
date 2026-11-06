/**
 * Mileage: the dated IRS rate, and which drives the job taps log on their
 * own. Pinned because a wrong rate, or a commute claimed as business, is a
 * wrong deduction.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { rateFor, mileageTotals, driveToJob, autoTripKey, estimateRoadMiles } = await import("../lib/mileage.ts");

describe("the IRS rate", () => {
  test("is the one in force on the trip's date, including 2026's mid-year change", () => {
    assert.equal(rateFor("2025-12-31"), 70);
    assert.equal(rateFor("2026-01-01"), 72.5);
    assert.equal(rateFor("2026-06-30"), 72.5);
    assert.equal(rateFor("2026-07-01"), 76);
    assert.equal(rateFor("2024-03-01"), 70); // before the table: its first rate
  });

  test("a year's deduction prices each trip at its own date's rate", () => {
    const t = mileageTotals(
      [
        { date: "2026-03-01", miles: 100 },
        { date: "2026-08-01", miles: 100 },
        { date: "2025-08-01", miles: 999 },
        { date: "2026-08-02", miles: -5 },
      ],
      2026,
    );
    assert.equal(t.miles, 200);
    assert.equal(t.deduction, 148.5);
    assert.equal(t.count, 2);
  });
});

describe("the drive to a job, from the job taps", () => {
  const to = { lat: 38.45, lng: -85.4, label: "Jones" };
  const prev = { id: "a", lat: 38.4, lng: -85.4, label: "Smith" };
  const home = { lat: 38.3, lng: -85.5 };
  const base = { to, gps: null, previousJob: null, home: null, homeIsMainOffice: false };

  test("the day's first drive is commuting, wherever it starts, unless home is the main office", () => {
    assert.deepEqual(driveToJob({ ...base, gps: { lat: 38.2, lng: -85.3 } }), { kind: "skip", reason: "commute" });
    const office = driveToJob({ ...base, gps: home, home, homeIsMainOffice: true });
    assert.equal(office.kind, "log");
    assert.equal(office.source, "home_to_job");
    assert.equal(office.reason, "Office → Job: Jones");
    assert.equal(office.fromJobId, null);
  });

  test("with home as the office but no location, home's pin is the start; with neither, nothing", () => {
    assert.equal(driveToJob({ ...base, home, homeIsMainOffice: true }).from.lat, 38.3);
    assert.deepEqual(driveToJob({ ...base, homeIsMainOffice: true }), { kind: "skip", reason: "no_origin" });
  });

  test("still at the last job, already at this one (a late tap), or no location: job to job from its pin", () => {
    for (const gps of [{ lat: 38.4005, lng: -85.4 }, { lat: 38.4501, lng: -85.4 }, null]) {
      const d = driveToJob({ ...base, gps, previousJob: prev });
      assert.equal(d.kind, "log");
      assert.equal(d.source, "job_to_job");
      assert.equal(d.reason, "Job: Smith → Jones");
      assert.deepEqual([d.from.lat, d.fromJobId], [38.4, "a"]);
    }
  });

  test("somewhere else after a job (the supply yard): from where the phone is", () => {
    const d = driveToJob({ ...base, gps: { lat: 38.5, lng: -85.45 }, previousJob: prev });
    assert.equal(d.source, "en_route");
    assert.equal(d.from.lat, 38.5);
    assert.equal(d.reason, "After Smith → Job: Jones");
  });

  test("no pin on the job, or a drive of a few hundred feet, logs nothing", () => {
    assert.deepEqual(driveToJob({ ...base, to: { lat: 0, lng: 0, label: "x" }, previousJob: prev }), { kind: "skip", reason: "no_destination" });
    assert.deepEqual(
      driveToJob({ ...base, previousJob: { ...prev, lat: 38.4501, lng: -85.4001 } }),
      { kind: "skip", reason: "too_short" },
    );
  });

  test("one trip per job: the key is the job's", () => {
    assert.equal(autoTripKey("j1"), "auto:j1");
  });

  test("the fallback road estimate is the straight line plus a third for winding roads", () => {
    const miles = estimateRoadMiles({ lat: 38.4, lng: -85.4 }, { lat: 38.5, lng: -85.4 });
    assert.ok(miles > 9 && miles < 9.5, String(miles));
  });
});
