/** Pay periods and the per-person numbers inside one. Dates are local time. */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { periodContaining, shiftPeriod, periodDays, periodSummary } = await import("../lib/payPeriods.ts");

const d = (local) => new Date(local);
const ymd = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const span = (p) => [ymd(p.start), ymd(p.end)];
const stamp = (local) => ({ toMillis: () => new Date(local).getTime() });

describe("which period a day falls in", () => {
  test("weekly from Monday: Aug 24 – Aug 30, like the reference screenshot", () => {
    const p = periodContaining(d("2026-08-27T15:00:00"), { frequency: "weekly", startsOn: 1 });
    assert.deepEqual(span(p), ["2026-08-24", "2026-08-31"]);
    assert.equal(periodDays(p), 7);
  });

  test("weekly from Sunday, on the Sunday itself", () => {
    const p = periodContaining(d("2026-11-01T09:00:00"), { frequency: "weekly", startsOn: 0 });
    assert.deepEqual(span(p), ["2026-11-01", "2026-11-08"]);
  });

  test("every two weeks keeps a fixed rhythm, whenever you look", () => {
    const schedule = { frequency: "biweekly", startsOn: 1 };
    const a = periodContaining(d("2026-11-10T12:00:00"), schedule);
    const b = periodContaining(d("2026-11-20T12:00:00"), schedule);
    assert.deepEqual(span(a), span(b), "same period from either end");
    assert.equal(periodDays(a), 14);
    assert.equal(a.start.getDay(), 1);
  });

  test("twice a month splits on the 16th, and the second half runs to month end", () => {
    const schedule = { frequency: "semimonthly", startsOn: 1 };
    assert.deepEqual(span(periodContaining(d("2026-02-10T12:00:00"), schedule)), ["2026-02-01", "2026-02-16"]);
    assert.deepEqual(span(periodContaining(d("2026-02-20T12:00:00"), schedule)), ["2026-02-16", "2026-03-01"]);
  });

  test("monthly, and stepping back across a year end", () => {
    const schedule = { frequency: "monthly", startsOn: 1 };
    const jan = periodContaining(d("2026-01-15T12:00:00"), schedule);
    assert.deepEqual(span(shiftPeriod(jan, -1, schedule)), ["2025-12-01", "2026-01-01"]);
    assert.deepEqual(span(shiftPeriod(jan, 2, schedule)), ["2026-03-01", "2026-04-01"]);
  });

  test("a week that crosses the end of daylight saving is still seven days", () => {
    const p = periodContaining(d("2026-11-01T12:00:00"), { frequency: "weekly", startsOn: 1 });
    assert.equal(periodDays(p), 7);
    assert.deepEqual(span(p), ["2026-10-26", "2026-11-02"]);
  });
});

describe("what each person did", () => {
  const period = { start: d("2026-08-24T00:00:00"), end: d("2026-08-31T00:00:00") };
  const job = (extra) => ({
    status: "complete",
    price: 400,
    assignedTo: ["nick"],
    scheduledStart: stamp("2026-08-25T09:00:00"),
    scheduledEnd: stamp("2026-08-25T11:00:00"),
    completedAt: stamp("2026-08-25T11:00:00"),
    ...extra,
  });

  test("a shared job splits its revenue and counts for both", () => {
    const [nick, dana] = periodSummary(["nick", "dana"], [job({ assignedTo: ["nick", "dana"] })], [], period);
    assert.equal(nick.jobs, 1);
    assert.equal(nick.revenue, 200);
    assert.equal(dana.revenue, 200);
  });

  test("hours come from Start and Finish when tapped, else the schedule", () => {
    const tapped = job({ startedAt: stamp("2026-08-25T09:10:00"), finishedAt: stamp("2026-08-25T12:40:00") });
    const [withTaps] = periodSummary(["nick"], [tapped], [], period);
    assert.equal(withTaps.hours, 3.5);
    const [scheduled] = periodSummary(["nick"], [job({})], [], period);
    assert.equal(scheduled.hours, 2);
  });

  test("only finished work inside the period counts, and estimate visits earn no revenue", () => {
    const [row] = periodSummary(
      ["nick"],
      [
        job({ status: "scheduled" }),
        job({ completedAt: stamp("2026-09-01T10:00:00") }),
        job({ visitType: "estimate" }),
      ],
      [],
      period,
    );
    assert.equal(row.jobs, 1, "the estimate visit was work done");
    assert.equal(row.revenue, 0);
  });

  test("sales: estimates sent and won by whoever raised them", () => {
    const docs = [
      { kind: "estimate", status: "accepted", total: 1200, createdBy: "dana", sentAt: stamp("2026-08-26T10:00:00") },
      { kind: "estimate", status: "sent", total: 500, createdBy: "dana", sentAt: stamp("2026-08-27T10:00:00") },
      { kind: "estimate", status: "draft", total: 900, createdBy: "dana", issuedAt: stamp("2026-08-27T10:00:00") },
      { kind: "invoice", status: "paid", total: 999, createdBy: "dana", sentAt: stamp("2026-08-27T10:00:00") },
    ];
    const [, dana] = periodSummary(["nick", "dana"], [], docs, period);
    assert.equal(dana.estimatesSent, 2);
    assert.equal(dana.estimatesWon, 1);
    assert.equal(dana.wonValue, 1200);
  });
});
