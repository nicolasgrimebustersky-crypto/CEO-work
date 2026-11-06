/**
 * Crew pay: hours from the taps plus approved corrections, pay at each
 * person's rate, and the 1099 threshold and W-9 flags.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  asPaySettings,
  contractorStatus,
  dateKey,
  editMinutes,
  paidInYear,
  parseHours,
  payFor,
  periodPay,
  runFor,
  yearPayTotals,
  DEFAULT_PERSON_PAY,
} = await import("../lib/crewPay.ts");
const { buildPacket } = await import("../lib/cpaPacket.ts");

const hourly = { classification: "1099", basis: "hourly", rate: 20, w9: null };

describe("time corrections", () => {
  test("reads decimal hours and h:mm, signed; refuses zero, junk and over 16 hours", () => {
    assert.equal(parseHours("1.5"), 90);
    assert.equal(parseHours("-0.25"), -15);
    assert.equal(parseHours("1:30"), 90);
    assert.equal(parseHours("-0:45"), -45);
    assert.equal(parseHours(".5"), 30);
    assert.equal(parseHours("0"), null);
    assert.equal(parseHours("abc"), null);
    assert.equal(parseHours("17"), null);
    assert.equal(parseHours("1:75"), null);
  });

  test("only that person's corrections inside the period count; pending are kept apart", () => {
    const edits = [
      { id: "a", uid: "u1", date: "2026-11-02", minutes: 60, reason: "", approved: true },
      { id: "b", uid: "u1", date: "2026-11-03", minutes: -30, reason: "", approved: true },
      { id: "c", uid: "u1", date: "2026-11-04", minutes: 45, reason: "", approved: false },
      { id: "d", uid: "u2", date: "2026-11-04", minutes: 600, reason: "", approved: true },
      { id: "e", uid: "u1", date: "2026-11-09", minutes: 600, reason: "", approved: true }, // next period
    ];
    assert.deepEqual(editMinutes(edits, "u1", "2026-11-02", "2026-11-09"), { approved: 30, pending: 45 });
  });
});

describe("pay for a period", () => {
  test("by the hour pays tap hours plus approved corrections, never pending ones", () => {
    const p = periodPay(hourly, { hours: 10, jobs: 4, revenue: 800 }, { approved: 90, pending: 120 });
    assert.equal(p.hours, 11.5);
    assert.equal(p.pendingHours, 2);
    assert.equal(p.gross, 230);
  });

  test("a correction can't push hours below zero", () => {
    assert.equal(periodPay(hourly, { hours: 1, jobs: 1, revenue: 0 }, { approved: -180, pending: 0 }).hours, 0);
  });

  test("by the job and by revenue share", () => {
    assert.equal(periodPay({ ...hourly, basis: "per_job", rate: 45 }, { hours: 9, jobs: 4, revenue: 800 }, { approved: 0, pending: 0 }).gross, 180);
    assert.equal(periodPay({ ...hourly, basis: "share", rate: 30 }, { hours: 9, jobs: 4, revenue: 812.5 }, { approved: 0, pending: 0 }).gross, 243.75);
  });
});

describe("paid records and the 1099", () => {
  const runs = [
    { id: "1", uid: "u1", name: "Jake", periodStart: "2026-01-05", periodEnd: "2026-01-12", gross: 900, classification: "1099", paidOn: "2026-01-13" },
    { id: "2", uid: "u1", name: "Jake", periodStart: "2026-12-28", periodEnd: "2027-01-04", gross: 600, classification: "1099", paidOn: "2027-01-05" },
    { id: "3", uid: "u1", name: "Jake", periodStart: "2025-12-22", periodEnd: "2025-12-29", gross: 400, classification: "1099", paidOn: "2026-01-02" },
    { id: "4", uid: "u2", name: "Sam", periodStart: "2026-01-05", periodEnd: "2026-01-12", gross: 1000, classification: "w2", paidOn: "2026-01-13" },
  ];

  test("the year goes by the day paid, not the period worked", () => {
    assert.equal(paidInYear(runs, "u1", 2026), 1300);
    assert.equal(paidInYear(runs, "u1", 2027), 600);
    assert.equal(runFor(runs, "u1", "2026-01-05").id, "1");
    assert.equal(runFor(runs, "u1", "2026-01-12"), undefined);
  });

  test("flags at the threshold, warns from 75%, and wants a W-9 from every contractor", () => {
    assert.deepEqual(contractorStatus(hourly, 2000, 2000), { flag: "needs_1099", w9Missing: true });
    assert.deepEqual(contractorStatus(hourly, 1500, 2000), { flag: "approaching", w9Missing: true });
    const withW9 = { ...hourly, w9: { url: "u", path: "w9/u1/x.pdf", contentType: "application/pdf", receivedOn: "2026-01-02" } };
    assert.deepEqual(contractorStatus(withW9, 100, 2000), { flag: "below", w9Missing: false });
    assert.deepEqual(contractorStatus({ ...hourly, classification: "w2" }, 99999, 2000), { flag: "employee", w9Missing: false });
  });

  test("the year splits into W-2 wages and 1099 contract labour", () => {
    const t = yearPayTotals(runs, 2026);
    assert.equal(t.wages, 1000);
    assert.equal(t.contract, 1300);
    assert.deepEqual(t.byPerson.map((p) => [p.name, p.paid, p.payments]), [["Jake", 1300, 2], ["Sam", 1000, 1]]);
  });

  test("the CPA packet puts W-2 pay on line 26 and 1099 pay on line 11 with the contractors", () => {
    const p = buildPacket({
      year: 2026,
      grossReceipts: 50_000,
      expenses: [{ id: "e", date: "2026-03-01", amount: 500, category: "labor", vendor: "jake", forWhat: "", paymentMethod: "cash", proof: "receipt", notes: "", createdByName: "R", receiptUrl: null }],
      trips: [],
      salesTax: { charged: 0, collected: 0 },
      mileageMethod: "standard",
      payRuns: runs.map(({ name, gross, classification, paidOn }) => ({ name, gross, classification, paidOn })),
    });
    const line = (n) => p.lines.find((l) => l.line === n)?.amount ?? 0;
    assert.equal(line("26"), 1000);
    assert.equal(line("11"), 1800);
    assert.equal(p.totalExpenses, 2800);
    assert.deepEqual(p.contractors.map((c) => [c.name, c.paid, c.needs1099]), [["jake", 1800, false]]);
  });
});

describe("stored settings", () => {
  test("bad values fall back; a rate over the cap is refused, not stored", () => {
    const s = asPaySettings({ people: { u1: { classification: "w2", basis: "hourly", rate: 2500 }, u2: { basis: "nope" } } });
    assert.equal(s.people.u1.classification, "w2");
    assert.equal(s.people.u1.rate, 0);
    assert.equal(s.people.u2.basis, "hourly");
    assert.deepEqual(payFor(s, "nobody"), DEFAULT_PERSON_PAY);
  });

  test("date keys are local calendar days", () => {
    assert.equal(dateKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  });
});

describe("overtime (W-2 only, by the workweek)", async () => {
  const { overtimeFor, OVERTIME_AFTER_HOURS } = await import("../lib/crewPay.ts");
  const { dailyWork } = await import("../lib/payPeriods.ts");
  const w2 = { classification: "w2", basis: "hourly", rate: 20, w9: null };
  // Mon 2026-11-02 … Sun 2026-11-08; workweek starts Monday (1).
  const week = (hoursPerDay, from = 2) =>
    hoursPerDay.map((h, i) => ({ date: `2026-11-${String(from + i).padStart(2, "0")}`, hours: h, jobs: h ? 1 : 0, revenue: h * 30 }));

  test("hours past 40 get the half-time premium on top of straight time", () => {
    const o = overtimeFor(w2, week([9, 9, 9, 9, 9, 0, 0]), "2026-11-02", "2026-11-09", 1);
    assert.equal(OVERTIME_AFTER_HOURS, 40);
    assert.equal(o.hours, 5);
    assert.equal(o.premium, 50); // 5 h × $20 × 0.5 — with 45 h straight time, 45×20 + 50 = 5 × 30 + 40 × 20
    const p = periodPay(w2, { hours: 45, jobs: 5, revenue: 0 }, { approved: 0, pending: 0 }, o);
    assert.equal(p.gross, 950);
    assert.equal(p.overtimeHours, 5);
  });

  test("40 hours or less, and contractors, get none", () => {
    assert.equal(overtimeFor(w2, week([8, 8, 8, 8, 8, 0, 0]), "2026-11-02", "2026-11-09", 1).hours, 0);
    assert.equal(overtimeFor({ ...w2, classification: "1099" }, week([12, 12, 12, 12, 0, 0, 0]), "2026-11-02", "2026-11-09", 1).hours, 0);
  });

  test("a workweek is counted in the period it ends in, with hours from before the period", () => {
    // Semimonthly period Nov 1–15. The week Mon Oct 26–Sun Nov 1 ends on Nov 1, inside it.
    const days = [
      ...["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].map((date) => ({ date, hours: 10, jobs: 1, revenue: 0 })),
    ];
    const o = overtimeFor(w2, days, "2026-11-01", "2026-11-16", 1);
    assert.deepEqual(o.weeks.map((w) => [w.start, w.overtimeHours]), [["2026-10-26", 10]]);
    // The same week is not counted again by the period before it.
    assert.equal(overtimeFor(w2, days, "2026-10-16", "2026-11-01", 1).hours, 0);
  });

  test("pay by the job: premium on the week's regular rate (earnings ÷ hours)", () => {
    const perJob = { ...w2, basis: "per_job", rate: 100 };
    // 10 jobs × $100 = $1,000 over 50 h → $20/h regular rate → 10 OT h × $10 = $100.
    const days = week([10, 10, 10, 10, 10, 0, 0]).map((d) => ({ ...d, jobs: d.hours ? 2 : 0 }));
    const o = overtimeFor(perJob, days, "2026-11-02", "2026-11-09", 1);
    assert.equal(o.weeks[0].regularRate, 20);
    assert.equal(o.premium, 100);
  });

  test("daily work is counted the way the period summary counts it", () => {
    const stamp = (iso) => ({ toMillis: () => new Date(iso).getTime() });
    const job = (over) => ({
      status: "complete",
      price: 200,
      visitType: "service",
      assignedTo: ["a", "b"],
      completedAt: stamp("2026-11-03T15:00:00"),
      startedAt: stamp("2026-11-03T09:00:00"),
      finishedAt: stamp("2026-11-03T15:00:00"),
      scheduledStart: stamp("2026-11-03T09:00:00"),
      scheduledEnd: stamp("2026-11-03T11:00:00"),
      ...over,
    });
    const window = { start: new Date(2026, 9, 26), end: new Date(2026, 10, 9) };
    const days = dailyWork("a", ["a", "b"], [job({}), job({ assignedTo: ["b"] }), job({ status: "scheduled" })], window);
    assert.deepEqual(days, [{ date: "2026-11-03", hours: 6, jobs: 1, revenue: 100 }]);
  });
});
