/** Follow-ups: due days, grouping, snoozing and the morning reminder. Dates are local time. */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  presetDue,
  dueLabel,
  dueTone,
  groupTasks,
  dueNow,
  snoozed,
  taskProblem,
  dueFromInput,
  inputFromDue,
  endOfDayIn,
  remindersDue,
  reminderBody,
  isMine,
} = await import("../lib/tasks.ts");

const at = (local) => new Date(local).getTime();
const stamp = (local) => ({ toMillis: () => new Date(local).getTime() });
const ymd = (date) => inputFromDue(date.getTime());
const task = (id, over = {}) => ({
  id,
  title: `Task ${id}`,
  dueAt: null,
  doneAt: null,
  assignedTo: null,
  createdBy: "alice",
  remindedAt: null,
  customerName: null,
  ...over,
});

// A Wednesday afternoon.
const NOW = at("2026-11-04T15:30:00");

describe("quick due dates", () => {
  test("today, tomorrow, in 3 days, in 2 weeks", () => {
    assert.equal(ymd(presetDue("today", NOW)), "2026-11-04");
    assert.equal(ymd(presetDue("tomorrow", NOW)), "2026-11-05");
    assert.equal(ymd(presetDue("3days", NOW)), "2026-11-07");
    assert.equal(ymd(presetDue("2weeks", NOW)), "2026-11-18");
  });

  test("next week is next Monday, including from a Sunday", () => {
    assert.equal(ymd(presetDue("nextweek", NOW)), "2026-11-09");
    assert.equal(ymd(presetDue("nextweek", at("2026-11-08T10:00:00"))), "2026-11-09");
    assert.equal(ymd(presetDue("nextweek", at("2026-11-09T10:00:00"))), "2026-11-16");
  });

  test("a month from Jan 31 is the end of February", () => {
    assert.equal(ymd(presetDue("month", at("2027-01-31T10:00:00"))), "2027-02-28");
    assert.equal(ymd(presetDue("month", NOW)), "2026-12-04");
  });

  test("every preset lands at 9am, inside the day", () => {
    assert.equal(presetDue("tomorrow", NOW).getHours(), 9);
  });

  test("a date input round-trips", () => {
    assert.equal(inputFromDue(dueFromInput("2026-12-25").getTime()), "2026-12-25");
    assert.equal(dueFromInput(""), null);
    assert.equal(dueFromInput("12/25/2026"), null);
  });
});

describe("how a due date reads", () => {
  test("relative words near today, a date further out", () => {
    assert.equal(dueLabel(at("2026-11-04T09:00:00"), NOW), "Today");
    assert.equal(dueLabel(at("2026-11-05T09:00:00"), NOW), "Tomorrow");
    assert.equal(dueLabel(at("2026-11-03T09:00:00"), NOW), "Yesterday");
    assert.equal(dueLabel(at("2026-11-01T09:00:00"), NOW), "3 days late");
    assert.equal(dueLabel(at("2026-11-06T09:00:00"), NOW), "Fri");
    assert.equal(dueLabel(at("2026-11-20T09:00:00"), NOW), "Nov 20");
  });

  test("due earlier today is not late", () => {
    assert.equal(dueTone(at("2026-11-04T09:00:00"), NOW), "today");
    assert.equal(dueTone(at("2026-11-03T23:00:00"), NOW), "late");
    assert.equal(dueTone(null, NOW), "none");
  });
});

describe("the list", () => {
  test("late, today, coming, no date, done", () => {
    const groups = groupTasks(
      [
        task("soon2", { dueAt: stamp("2026-11-10T09:00:00") }),
        task("late", { dueAt: stamp("2026-11-01T09:00:00") }),
        task("today", { dueAt: stamp("2026-11-04T09:00:00") }),
        task("soon1", { dueAt: stamp("2026-11-05T09:00:00") }),
        task("someday"),
        task("doneOld", { doneAt: stamp("2026-11-01T09:00:00"), dueAt: stamp("2026-11-01T09:00:00") }),
        task("doneNew", { doneAt: stamp("2026-11-03T09:00:00") }),
      ],
      NOW,
    );
    const ids = (list) => list.map((t) => t.id);
    assert.deepEqual(ids(groups.overdue), ["late"]);
    assert.deepEqual(ids(groups.today), ["today"]);
    assert.deepEqual(ids(groups.upcoming), ["soon1", "soon2"]);
    assert.deepEqual(ids(groups.someday), ["someday"]);
    assert.deepEqual(ids(groups.done), ["doneNew", "doneOld"]);
  });

  test("due now counts late and today, not done and not undated", () => {
    const list = [
      task("a", { dueAt: stamp("2026-11-01T09:00:00") }),
      task("b", { dueAt: stamp("2026-11-04T09:00:00") }),
      task("c", { dueAt: stamp("2026-11-05T09:00:00") }),
      task("d", { dueAt: stamp("2026-11-01T09:00:00"), doneAt: stamp("2026-11-02T09:00:00") }),
      task("e"),
    ];
    assert.deepEqual(dueNow(list, NOW).map((t) => t.id), ["a", "b"]);
  });

  test("mine means assigned to me, or written by me for nobody in particular", () => {
    assert.equal(isMine(task("x", { assignedTo: "bob" }), "bob"), true);
    assert.equal(isMine(task("x", { assignedTo: "bob" }), "alice"), false);
    assert.equal(isMine(task("x"), "alice"), true);
    assert.equal(isMine(task("x"), null), false);
  });
});

describe("snoozing", () => {
  test("pushes a future date back from that date", () => {
    assert.equal(ymd(snoozed(at("2026-11-06T09:00:00"), 1, NOW)), "2026-11-07");
  });

  test("a late task snoozes from today, not from when it was due", () => {
    assert.equal(ymd(snoozed(at("2026-10-28T09:00:00"), 1, NOW)), "2026-11-05");
    assert.equal(ymd(snoozed(null, 7, NOW)), "2026-11-11");
  });
});

describe("saving", () => {
  test("needs a title, and not a novel", () => {
    assert.ok(taskProblem({ title: "  " }));
    assert.ok(taskProblem({ title: "x".repeat(301) }));
    assert.ok(taskProblem({ title: "Call", notes: "x".repeat(2001) }));
    assert.equal(taskProblem({ title: "Call Marta back" }), null);
  });
});

describe("the morning reminder", () => {
  test("today ends at local midnight in Kentucky, whatever the server clock says", () => {
    // 13:00 UTC on Nov 4 is 8am in Louisville (EST, UTC-5).
    const end = endOfDayIn(Date.UTC(2026, 10, 4, 13), "America/Kentucky/Louisville");
    assert.equal(end, Date.UTC(2026, 10, 5, 5) - 1);
    // Summer: EDT, UTC-4.
    const summer = endOfDayIn(Date.UTC(2026, 6, 4, 13), "America/Kentucky/Louisville");
    assert.equal(summer, Date.UTC(2026, 6, 5, 4) - 1);
    // 02:00 UTC is still the previous evening there.
    const late = endOfDayIn(Date.UTC(2026, 10, 5, 2), "America/Kentucky/Louisville");
    assert.equal(late, Date.UTC(2026, 10, 5, 5) - 1);
  });

  test("open, due by tonight, not yet reminded, one list per person", () => {
    const cutoff = at("2026-11-04T23:59:59");
    const list = [
      task("bobLate", { assignedTo: "bob", dueAt: stamp("2026-11-02T09:00:00") }),
      task("bobToday", { assignedTo: "bob", dueAt: stamp("2026-11-04T09:00:00") }),
      task("aliceToday", { dueAt: stamp("2026-11-04T09:00:00") }),
      task("tomorrow", { dueAt: stamp("2026-11-05T09:00:00") }),
      task("reminded", { dueAt: stamp("2026-11-04T09:00:00"), remindedAt: stamp("2026-11-04T08:00:00") }),
      task("done", { dueAt: stamp("2026-11-04T09:00:00"), doneAt: stamp("2026-11-04T08:00:00") }),
      task("undated"),
    ];
    const due = remindersDue(list, cutoff);
    assert.deepEqual([...due.keys()].sort(), ["alice", "bob"]);
    assert.deepEqual(due.get("bob").map((t) => t.id), ["bobLate", "bobToday"]);
    assert.deepEqual(due.get("alice").map((t) => t.id), ["aliceToday"]);
  });

  test("one line, however many are due", () => {
    assert.equal(
      reminderBody([{ title: "Call back", customerName: "Marta Oakley" }]),
      "Call back · Marta Oakley",
    );
    assert.equal(
      reminderBody([
        { title: "Call back", customerName: null },
        { title: "Send quote", customerName: "X" },
        { title: "Check gutters", customerName: "Y" },
      ]),
      "Call back, and 2 more",
    );
  });
});
