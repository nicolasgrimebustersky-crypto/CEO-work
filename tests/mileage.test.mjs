/**
 * Mileage: the dated IRS rate, the trips a day implies, and when the app may
 * ask about a drive. Pinned because a wrong rate or a silent trip is a wrong
 * deduction.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { rateFor, mileageTotals, suggestTrips, gapDecision, estimateRoadMiles } = await import("../lib/mileage.ts");

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

const job = (id, lat, lng, startedAt, label = id) => ({ id, lat, lng, startedAt, label });

describe("trips a day implies", () => {
  const jobs = [job("b", 38.41, -85.4, 2000, "Jones"), job("a", 38.4, -85.4, 1000, "Smith"), job("x", 0, 0, 1500)];

  test("job to job in the order the work started, no-location jobs skipped", () => {
    const trips = suggestTrips("2026-05-04", jobs, null, false);
    assert.equal(trips.length, 1);
    assert.equal(trips[0].reason, "Job: Smith → Jones");
    assert.equal(trips[0].key, "2026-05-04:a:b");
    assert.equal(trips[0].source, "job_to_job");
  });

  test("home to the first job only when home is the main office", () => {
    const home = { lat: 38.39, lng: -85.41, label: "Home" };
    assert.equal(suggestTrips("2026-05-04", jobs, home, false).length, 1);
    const withOffice = suggestTrips("2026-05-04", jobs, home, true);
    assert.equal(withOffice.length, 2);
    assert.equal(withOffice[0].source, "home_to_job");
    assert.equal(withOffice[0].reason, "Office → Job: Smith");
  });
});

describe("asking about a GPS gap", () => {
  const jobs = [job("a", 38.4, -85.4, 0, "Smith")];
  const now = { lat: 38.45, lng: -85.4, at: 3 * 3600_000 };
  const atJob = { lat: 38.4001, lng: -85.4, at: 3600_000 };

  test("asks when the last position was at a job and the drive is real", () => {
    const d = gapDecision({ last: atJob, now, jobs, home: null });
    assert.equal(d.kind, "ask");
    assert.equal(d.fromJob.id, "a");
  });

  test("never asks for a gap over four hours", () => {
    assert.equal(gapDecision({ last: { ...atJob, at: 0 }, now: { ...now, at: 5 * 3600_000 }, jobs, home: null }).reason, "too_long");
  });

  test("never asks when the drive ended at home", () => {
    assert.equal(gapDecision({ last: atJob, now, jobs, home: { lat: 38.4501, lng: -85.4 } }).reason, "near_home");
  });

  test("never asks when the last position was not at a job, or nothing moved", () => {
    assert.equal(gapDecision({ last: { lat: 38.5, lng: -85.5, at: 3600_000 }, now, jobs, home: null }).reason, "not_at_job");
    assert.equal(gapDecision({ last: atJob, now: { lat: 38.4005, lng: -85.4, at: 2 * 3600_000 }, jobs, home: null }).reason, "too_short");
    assert.equal(gapDecision({ last: null, now, jobs, home: null }).reason, "no_last");
  });

  test("the fallback road estimate is the straight line plus a third for winding roads", () => {
    const miles = estimateRoadMiles({ lat: 38.4, lng: -85.4 }, { lat: 38.5, lng: -85.4 });
    assert.ok(miles > 9 && miles < 9.5, String(miles));
  });
});
