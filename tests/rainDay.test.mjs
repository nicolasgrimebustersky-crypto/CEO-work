/**
 * Rain day: next open day, plan cadence kept, one text per customer.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { planRainDay, customersToText, RAIN_DEFAULTS } = await import("../lib/rainDay.ts");

// 2026-11-10 is a Tuesday.
const job = (id, date, over = {}) => ({
  id,
  customerId: `c-${id}`,
  date,
  startMinutes: 9 * 60,
  durationMinutes: 60,
  status: "scheduled",
  planDate: null,
  ...over,
});

describe("moving a rained-out day", () => {
  test("to the next work day, keeping the time of day, earliest first", () => {
    const p = planRainDay(["2026-11-10"], [job("a", "2026-11-10", { startMinutes: 600 }), job("b", "2026-11-10", { startMinutes: 480 })], {});
    assert.deepEqual(
      p.moves.map((m) => [m.jobId, m.to, m.startMinutes]),
      [
        ["b", "2026-11-11", 480],
        ["a", "2026-11-11", 600],
      ],
    );
  });

  test("a full day is passed over; Sunday is not a work day", () => {
    const fullWed = [job("w1", "2026-11-11", { durationMinutes: 600 })];
    const p = planRainDay(["2026-11-14"], [job("sat", "2026-11-14"), ...fullWed], {}); // Saturday rain → Monday
    assert.equal(p.moves[0].to, "2026-11-16");
    const q = planRainDay(["2026-11-10"], [job("t", "2026-11-10"), ...fullWed], {});
    assert.equal(q.moves[0].to, "2026-11-12");
  });

  test("several rained-out days: nothing lands on another rained-out day", () => {
    const p = planRainDay(["2026-11-10", "2026-11-11"], [job("t", "2026-11-10"), job("w", "2026-11-11")], {});
    assert.deepEqual(p.moves.map((m) => m.to), ["2026-11-12", "2026-11-12"]);
  });

  test("capacity fills up, then the next day takes the overflow", () => {
    const jobs = [1, 2, 3].map((n) => job(`j${n}`, "2026-11-10", { startMinutes: 400 + n, durationMinutes: 240 }));
    const p = planRainDay(["2026-11-10"], jobs, {}, { ...RAIN_DEFAULTS, capacityMinutes: 480 });
    assert.deepEqual(p.moves.map((m) => m.to), ["2026-11-11", "2026-11-11", "2026-11-12"]);
  });

  test("finished, cancelled and started jobs stay put", () => {
    const p = planRainDay(
      ["2026-11-10"],
      [job("done", "2026-11-10", { status: "complete" }), job("x", "2026-11-10", { status: "cancelled" }), job("on", "2026-11-10", { status: "in_progress" })],
      {},
    );
    assert.equal(p.moves.length + p.skips.length + p.unplaced.length, 0);
  });
});

describe("recurring plans keep their cadence", () => {
  test("a weekly visit moves within the week, never onto next week's visit", () => {
    const jobs = [job("p", "2026-11-10", { planDate: "2026-11-10" })];
    const p = planRainDay(["2026-11-10"], jobs, { p: "2026-11-17" });
    assert.equal(p.moves[0].to, "2026-11-11");
  });

  test("no room before the next visit: skip this one, keep the next", () => {
    const jobs = [
      job("p", "2026-11-10", { planDate: "2026-11-10" }),
      ...["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-16"].map((d, i) => job(`full${i}`, d, { durationMinutes: 600 })),
    ];
    const p = planRainDay(["2026-11-10"], jobs, { p: "2026-11-17" });
    assert.deepEqual(p.skips, [{ jobId: "p", customerId: "c-p", from: "2026-11-10", nextVisit: "2026-11-17" }]);
    assert.equal(p.moves.length, 0);
  });

  test("a one-off with nowhere to go in two weeks is left for a person", () => {
    const busy = [];
    for (let d = 11; d <= 30; d++) busy.push(job(`b${d}`, `2026-11-${String(d).padStart(2, "0")}`, { durationMinutes: 600 }));
    const p = planRainDay(["2026-11-10"], [job("o", "2026-11-10"), ...busy], {});
    assert.deepEqual(p.unplaced.map((u) => u.jobId), ["o"]);
  });
});

test("one text per customer, however many of their jobs moved", () => {
  const jobs = [job("a", "2026-11-10"), job("b", "2026-11-10", { customerId: "c-a", startMinutes: 700 })];
  assert.deepEqual(customersToText(planRainDay(["2026-11-10"], jobs, {})), ["c-a"]);
});
