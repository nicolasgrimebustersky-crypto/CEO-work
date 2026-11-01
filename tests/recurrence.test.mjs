/** Repeat visits: the dates a "book again" or "make recurring" tap creates. */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { repeatVisits, MAX_REPEATS } = await import("../lib/recurrence.ts");

const visit = (start, minutes = 120) => {
  const s = new Date(start);
  return { start: s, end: new Date(s.getTime() + minutes * 60_000) };
};
const day = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const time = (date) => `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;

describe("repeat visits", () => {
  test("every two weeks, keeping the time and the length", () => {
    const visits = repeatVisits(visit("2026-11-02T09:00:00", 90), "2weeks", 3);
    assert.deepEqual(visits.map((v) => day(v.start)), ["2026-11-16", "2026-11-30", "2026-12-14"]);
    for (const v of visits) {
      assert.equal(time(v.start), "9:00");
      assert.equal((v.end - v.start) / 60_000, 90);
    }
  });

  test("a weekly job keeps its clock time across the end of daylight saving", () => {
    // Nov 1 2026 is the US fall-back. A 9am job must stay a 9am job.
    const visits = repeatVisits(visit("2026-10-26T09:00:00"), "week", 2);
    assert.deepEqual(visits.map((v) => time(v.start)), ["9:00", "9:00"]);
  });

  test("monthly on the 31st clamps to short months without drifting", () => {
    const visits = repeatVisits(visit("2026-01-31T10:00:00"), "month", 3);
    assert.deepEqual(visits.map((v) => day(v.start)), ["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  test("every 3 months and every year", () => {
    assert.deepEqual(
      repeatVisits(visit("2026-04-15T08:00:00"), "3months", 2).map((v) => day(v.start)),
      ["2026-07-15", "2026-10-15"],
    );
    assert.deepEqual(
      repeatVisits(visit("2028-02-29T08:00:00"), "year", 1).map((v) => day(v.start)),
      ["2029-02-28"],
    );
  });

  test("the original visit is not repeated, and the count is bounded", () => {
    assert.equal(repeatVisits(visit("2026-11-02T09:00:00"), "week", 0).length, 0);
    assert.equal(repeatVisits(visit("2026-11-02T09:00:00"), "week", -3).length, 0);
    assert.equal(repeatVisits(visit("2026-11-02T09:00:00"), "week", 500).length, MAX_REPEATS);
  });
});
