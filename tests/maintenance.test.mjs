/**
 * Maintenance reminders: due by the calendar or the meter, reset by doing
 * the work, and one notice per state rather than one a day.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { taskStatus, allStatuses, latestReading, dueText, noticeKey, equipmentFor, asEquipment } = await import("../lib/maintenance.ts");

const mower = {
  id: "m1",
  name: "Zero-turn",
  meter: "hours",
  tasks: [
    { id: "oil", what: "Oil change", everyDays: null, everyUnits: 50 },
    { id: "grease", what: "Grease deck", everyDays: 30, everyUnits: null },
    { id: "blades", what: "Blades", everyDays: 30, everyUnits: 25 },
  ],
};
let n = 0;
const entry = (date, taskIds, reading = null) => ({ id: `e${++n}`, equipmentId: "m1", date, taskIds, reading, at: n });

describe("due by the calendar", () => {
  test("ok, then due soon in the last quarter, then overdue", () => {
    const log = [entry("2026-10-01", ["grease"])];
    const t = mower.tasks[1];
    assert.equal(taskStatus(mower, t, log, "2026-10-15").state, "ok");
    const soon = taskStatus(mower, t, log, "2026-10-25");
    assert.equal(soon.state, "due_soon");
    assert.equal(soon.dueOn, "2026-10-31");
    assert.equal(soon.daysLeft, 6);
    const late = taskStatus(mower, t, log, "2026-11-03");
    assert.equal(late.state, "overdue");
    assert.equal(dueText(late, "hours"), "3 days overdue");
  });

  test("never logged is its own state, not overdue", () => {
    assert.equal(taskStatus(mower, mower.tasks[1], [], "2026-11-03").state, "never_logged");
  });

  test("doing it again resets the clock", () => {
    const log = [entry("2026-09-01", ["grease"]), entry("2026-11-01", ["grease"])];
    assert.equal(taskStatus(mower, mower.tasks[1], log, "2026-11-03").state, "ok");
  });
});

describe("due by the hour meter", () => {
  test("from the reading at the service to the newest reading", () => {
    const log = [entry("2026-09-01", ["oil"], 200), entry("2026-10-01", [], 238), entry("2026-10-20", [], 246)];
    const s = taskStatus(mower, mower.tasks[0], log, "2026-10-21");
    assert.equal(s.dueAt, 250);
    assert.equal(s.unitsLeft, 4);
    assert.equal(s.state, "due_soon");
    log.push(entry("2026-10-25", [], 253));
    const over = taskStatus(mower, mower.tasks[0], log, "2026-10-26");
    assert.equal(over.state, "overdue");
    assert.equal(dueText(over, "hours"), "3 hours over");
  });

  test("a service logged without hours uses the last reading on or before that day", () => {
    const log = [entry("2026-09-01", [], 180), entry("2026-09-02", ["oil"]), entry("2026-10-01", [], 210)];
    assert.equal(taskStatus(mower, mower.tasks[0], log, "2026-10-02").dueAt, 230);
  });

  test("no readings at all: asks for one rather than guessing", () => {
    const s = taskStatus(mower, mower.tasks[0], [entry("2026-09-01", ["oil"])], "2026-10-02");
    assert.equal(s.needsReading, true);
    assert.equal(s.state, "ok");
  });

  test("whichever comes first: days or hours", () => {
    const log = [entry("2026-10-01", ["blades"], 100), entry("2026-10-05", [], 126)];
    assert.equal(taskStatus(mower, mower.tasks[2], log, "2026-10-06").state, "overdue"); // hours ran out first
  });

  test("the newest reading wins, by date then by when it was logged", () => {
    const log = [entry("2026-10-05", [], 300), entry("2026-10-01", [], 400), entry("2026-10-05", [], 310)];
    assert.deepEqual(latestReading("m1", log), { value: 310, date: "2026-10-05" });
  });
});

describe("reminders", () => {
  test("one notice when it comes due soon, one when overdue, a fresh pair after it is done", () => {
    const log = [entry("2026-10-01", ["grease"])];
    const t = mower.tasks[1];
    const soon = noticeKey(taskStatus(mower, t, log, "2026-10-25"));
    assert.equal(soon, noticeKey(taskStatus(mower, t, log, "2026-10-26")));
    const over = noticeKey(taskStatus(mower, t, log, "2026-11-02"));
    assert.notEqual(soon, over);
    assert.equal(noticeKey(taskStatus(mower, t, log, "2026-10-10")), null);
    log.push(entry("2026-11-03", ["grease"]));
    assert.equal(noticeKey(taskStatus(mower, t, log, "2026-11-30")), "due_soon:2026-11-03");
  });

  test("most urgent first", () => {
    const log = [entry("2026-10-01", ["grease", "oil"], 10), entry("2026-10-02", [], 12)];
    const order = allStatuses([mower], log, "2026-11-03").map((s) => [s.task.id, s.state]);
    assert.deepEqual(order[0], ["grease", "overdue"]);
    assert.equal(order.at(-1)[1], "ok");
  });
});

describe("linking expenses and stored data", () => {
  test("an expense's 'for' name finds the equipment, case and spaces aside", () => {
    assert.equal(equipmentFor("  zero-TURN ", [mower])?.id, "m1");
    assert.equal(equipmentFor("Truck", [mower]), null);
    assert.equal(equipmentFor("", [mower]), null);
  });

  test("tasks with no interval are dropped; a meterless machine has no hour intervals", () => {
    const e = asEquipment("x", {
      name: "Push mower",
      meter: "none",
      tasks: [
        { id: "a", what: "Blade", everyDays: 30, everyUnits: 25 },
        { id: "b", what: "Nothing", everyDays: null, everyUnits: null },
        { id: "c", what: "", everyDays: 5 },
      ],
    });
    assert.deepEqual(e.tasks, [{ id: "a", what: "Blade", everyDays: 30, everyUnits: null }]);
  });
});
