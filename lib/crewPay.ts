/**
 * Crew pay: what each person is owed for a pay period, and what they were
 * paid over the year.
 *
 *   Hours  come from the Start and Finish taps on each job (lib/payPeriods.ts),
 *          plus time corrections. A correction is never an edit of the taps:
 *          it is its own logged entry with a reason, and one a crew member
 *          adds for themselves counts only once the owner approves it.
 *   Rate   is set by the owner per person: by the hour, by the job, or a
 *          share of the revenue on their jobs. Only the owner can read it.
 *   Pay    is recorded by the owner when it is paid, with the rate copied
 *          onto the record, so a later raise never rewrites last month.
 *
 * W-2 or 1099: for a 1099 contractor the year's payments are checked
 * against the 1099-NEC threshold and a missing W-9 is flagged. For a W-2
 * employee gross pay includes overtime (overtimeFor: time and a half past
 * 40 hours in a workweek); withholding, payroll taxes and the W-2 itself
 * still belong with a payroll service.
 *
 * Free of imports so every rule is tested by calling it.
 */

export const CLASSIFICATIONS = ["w2", "1099"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  w2: "Employee (W-2)",
  "1099": "Contractor (1099)",
};

export const PAY_BASES = ["hourly", "per_job", "share"] as const;
export type PayBasis = (typeof PAY_BASES)[number];

export const PAY_BASIS_LABEL: Record<PayBasis, string> = {
  hourly: "By the hour",
  per_job: "By the job",
  share: "Share of job revenue",
};

export interface W9File {
  url: string;
  /** Storage path, for replacing or removing it. */
  path: string;
  contentType: string;
  /** "YYYY-MM-DD" */
  receivedOn: string;
}

export interface PersonPay {
  classification: Classification;
  basis: PayBasis;
  /** Dollars per hour or per job; percent for a revenue share. */
  rate: number;
  w9: W9File | null;
}

export const DEFAULT_PERSON_PAY: PersonPay = { classification: "1099", basis: "hourly", rate: 0, w9: null };

export interface PaySettings {
  people: Record<string, PersonPay>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Upper bound on a rate: catches a typo like 2500 for $25.00. */
export function maxRate(basis: PayBasis): number {
  return basis === "share" ? 100 : basis === "hourly" ? 500 : 5000;
}

export function asPersonPay(raw: unknown): PersonPay {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const classification = (CLASSIFICATIONS as readonly string[]).includes(String(r.classification))
    ? (r.classification as Classification)
    : DEFAULT_PERSON_PAY.classification;
  const basis = (PAY_BASES as readonly string[]).includes(String(r.basis)) ? (r.basis as PayBasis) : DEFAULT_PERSON_PAY.basis;
  const rate = typeof r.rate === "number" && Number.isFinite(r.rate) && r.rate >= 0 && r.rate <= maxRate(basis) ? r.rate : 0;
  const w = r.w9 && typeof r.w9 === "object" ? (r.w9 as Record<string, unknown>) : null;
  const w9 =
    w && typeof w.url === "string" && typeof w.path === "string"
      ? {
          url: w.url,
          path: w.path,
          contentType: typeof w.contentType === "string" ? w.contentType : "application/pdf",
          receivedOn: typeof w.receivedOn === "string" && DATE.test(w.receivedOn) ? w.receivedOn : "",
        }
      : null;
  return { classification, basis, rate, w9 };
}

export function asPaySettings(raw: unknown): PaySettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const people: Record<string, PersonPay> = {};
  if (r.people && typeof r.people === "object") {
    for (const [uid, value] of Object.entries(r.people as Record<string, unknown>)) people[uid] = asPersonPay(value);
  }
  return { people };
}

export function payFor(settings: PaySettings, uid: string): PersonPay {
  return settings.people[uid] ?? DEFAULT_PERSON_PAY;
}

/* ------------------------------------------------------------ dates */

/** "YYYY-MM-DD" in local time, the way pay periods and edits are dated. */
export function dateKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/* ---------------------------------------------------- time corrections */

/** A logged correction to someone's hours: plus for time the taps missed, minus for time they overcounted. */
export interface TimeEdit {
  id: string;
  /** Whose hours. */
  uid: string;
  /** "YYYY-MM-DD", the day the work was done. */
  date: string;
  minutes: number;
  reason: string;
  /** Owner-entered corrections are approved when made; a crew member's wait for the owner. */
  approved: boolean;
}

/** Sixteen hours either way: the same cap as one job's hours. */
export const MAX_EDIT_MINUTES = 16 * 60;

/**
 * "1.5", "-0.25", "1:30" or "-0:45" hours to whole minutes, or null when it
 * is not a usable correction (zero, unreadable, or over 16 hours).
 */
export function parseHours(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "");
  let minutes: number;
  const clock = /^([+-]?)(\d{1,2}):([0-5]\d)$/.exec(t);
  if (clock) {
    minutes = Number(clock[2]) * 60 + Number(clock[3]);
    if (clock[1] === "-") minutes = -minutes;
  } else if (/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) {
    minutes = Math.round(Number(t) * 60);
  } else {
    return null;
  }
  if (!Number.isFinite(minutes) || minutes === 0 || Math.abs(minutes) > MAX_EDIT_MINUTES) return null;
  return minutes;
}

const inPeriod = (date: string, startKey: string, endKey: string) => date >= startKey && date < endKey;

/** Approved and pending correction minutes for one person in [startKey, endKey). */
export function editMinutes(
  edits: readonly TimeEdit[],
  uid: string,
  startKey: string,
  endKey: string,
): { approved: number; pending: number } {
  let approved = 0;
  let pending = 0;
  for (const e of edits) {
    if (e.uid !== uid || !inPeriod(e.date, startKey, endKey) || !Number.isFinite(e.minutes)) continue;
    if (e.approved) approved += e.minutes;
    else pending += e.minutes;
  }
  return { approved, pending };
}

/* --------------------------------------------------------------- pay */

export interface PeriodWork {
  /** Hours from the Start and Finish taps. */
  hours: number;
  jobs: number;
  /** Their share of the revenue on jobs they finished. */
  revenue: number;
}

export interface PeriodPay {
  tapHours: number;
  /** Approved corrections, in hours. */
  correctionHours: number;
  /** Corrections waiting for the owner, in hours; not paid until approved. */
  pendingHours: number;
  hours: number;
  jobs: number;
  revenue: number;
  /** Overtime hours in workweeks ending this period (W-2 only). */
  overtimeHours: number;
  /** The half-time premium on them; included in `gross`. */
  overtimePremium: number;
  gross: number;
}

/**
 * What one person earned in a period at their rate, plus any overtime
 * premium (overtimeFor). Hours are never below zero.
 */
export function periodPay(
  person: PersonPay,
  work: PeriodWork,
  edits: { approved: number; pending: number },
  overtime: Overtime = NO_OVERTIME,
): PeriodPay {
  const tapHours = Math.max(0, work.hours);
  const hours = Math.max(0, Math.round((tapHours + edits.approved / 60) * 100) / 100);
  const jobs = Math.max(0, work.jobs);
  const revenue = Math.max(0, work.revenue);
  const gross =
    person.basis === "hourly"
      ? hours * person.rate
      : person.basis === "per_job"
        ? jobs * person.rate
        : (revenue * person.rate) / 100;
  return {
    tapHours: Math.round(tapHours * 100) / 100,
    correctionHours: Math.round((edits.approved / 60) * 100) / 100,
    pendingHours: Math.round((edits.pending / 60) * 100) / 100,
    hours,
    jobs,
    revenue: round2(revenue),
    overtimeHours: overtime.hours,
    overtimePremium: overtime.premium,
    gross: round2(gross + overtime.premium),
  };
}

/* ------------------------------------------------------------ overtime */

/** Hours in a workweek past which a W-2 employee is owed time and a half (FLSA; KRS 337.285). */
export const OVERTIME_AFTER_HOURS = 40;

export interface DayHours {
  /** "YYYY-MM-DD" */
  date: string;
  hours: number;
  jobs: number;
  revenue: number;
}

export interface OvertimeWeek {
  /** "YYYY-MM-DD", first day of the workweek. */
  start: string;
  hours: number;
  /** Hours the premium is paid on: past 40, or the seventh day's if that is more. */
  overtimeHours: number;
  /** Which rule set the premium hours. */
  rule: "weekly" | "seventh_day";
  /** Hours worked on the seventh day, when all seven days were worked. */
  seventhDayHours: number;
  /** What the hours were paid at straight time, divided by the hours: the "regular rate". */
  regularRate: number;
  premium: number;
}

export interface Overtime {
  hours: number;
  premium: number;
  weeks: OvertimeWeek[];
}

const NO_OVERTIME: Overtime = { hours: 0, premium: 0, weeks: [] };

function dayNum(key: string): number {
  return Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000);
}

function keyOf(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Overtime owed in the pay period [startKey, endKey) to a W-2 employee.
 *
 * Overtime goes by the workweek — a fixed 7 days starting on `weekStartsOn`
 * (0 = Sunday) — never by the pay period, so a week that straddles two
 * periods is still one week. Every hour is already paid at straight time in
 * the period it was worked (periodPay); what this adds is the half-time
 * premium on the hours past 40, in the period the workweek ends.
 *
 * Kentucky adds a seventh-day rule (KRS 337.050): an employee who works all
 * seven days of a workweek is owed time and a half for the hours on the
 * seventh — unless they were not allowed over 40 hours that week, read here
 * as: it applies when the week's hours pass 40. Overtime paid under the
 * 40-hour rule counts toward it (the statute credits one against the other),
 * so the week's premium hours are whichever is larger, never both.
 *
 * The premium is half the week's regular rate per overtime hour. For an
 * hourly rate that is half the rate; for pay by the job or a revenue share
 * it is the week's straight-time earnings divided by its hours, as the FLSA
 * requires for piece-rate pay (29 CFR 778.111). Contractors (1099) get none.
 *
 * `days` must cover every day of each workweek ending in the period, which
 * can start up to six days before the period does.
 */
export function overtimeFor(
  person: PersonPay,
  days: readonly DayHours[],
  startKey: string,
  endKey: string,
  weekStartsOn: number,
): Overtime {
  if (person.classification !== "w2" || person.rate <= 0) return NO_OVERTIME;
  const byDay = new Map<number, DayHours>();
  for (const d of days) {
    const n = dayNum(d.date);
    const prev = byDay.get(n);
    byDay.set(
      n,
      prev
        ? { date: d.date, hours: prev.hours + d.hours, jobs: prev.jobs + d.jobs, revenue: prev.revenue + d.revenue }
        : { ...d },
    );
  }

  const first = dayNum(startKey);
  const last = dayNum(endKey) - 1;
  const weeks: OvertimeWeek[] = [];
  for (let end = first; end <= last; end += 1) {
    // A workweek's last day is the day before the weekday it starts on.
    if (new Date(end * 86_400_000).getUTCDay() !== (weekStartsOn + 6) % 7) continue;
    let hours = 0;
    let jobs = 0;
    let revenue = 0;
    let daysWorked = 0;
    for (let d = end - 6; d <= end; d += 1) {
      const w = byDay.get(d);
      if (!w) continue;
      hours += Math.max(0, w.hours);
      jobs += Math.max(0, w.jobs);
      revenue += Math.max(0, w.revenue);
      if (w.hours > 0) daysWorked += 1;
    }
    const weeklyHours = Math.max(0, hours - OVERTIME_AFTER_HOURS);
    // KRS 337.050: all seven days worked and over 40 hours → the seventh day's hours.
    const seventhDayHours =
      daysWorked === 7 && hours > OVERTIME_AFTER_HOURS ? Math.max(0, byDay.get(end)?.hours ?? 0) : 0;
    const overtimeHours = Math.max(weeklyHours, seventhDayHours);
    if (overtimeHours <= 0) continue;
    const straight =
      person.basis === "hourly" ? hours * person.rate : person.basis === "per_job" ? jobs * person.rate : (revenue * person.rate) / 100;
    const regularRate = hours > 0 ? straight / hours : 0;
    weeks.push({
      start: keyOf(end - 6),
      hours: Math.round(hours * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 100) / 100,
      rule: seventhDayHours > weeklyHours ? "seventh_day" : "weekly",
      seventhDayHours: Math.round(seventhDayHours * 100) / 100,
      regularRate: round2(regularRate),
      premium: round2(overtimeHours * regularRate * 0.5),
    });
  }
  return {
    hours: Math.round(weeks.reduce((s, w) => s + w.overtimeHours, 0) * 100) / 100,
    premium: round2(weeks.reduce((s, w) => s + w.premium, 0)),
    weeks,
  };
}

/* -------------------------------------------------------- paid records */

export interface PayRun {
  id: string;
  uid: string;
  name: string;
  /** "YYYY-MM-DD", first day of the period. */
  periodStart: string;
  /** "YYYY-MM-DD", exclusive. */
  periodEnd: string;
  gross: number;
  classification: Classification;
  /** "YYYY-MM-DD", the day it was paid — what the 1099 year goes by. */
  paidOn: string;
}

/** The record of this person's pay for the period starting `startKey`, if it was paid. */
export function runFor<T extends PayRun>(runs: readonly T[], uid: string, startKey: string): T | undefined {
  return runs.find((r) => r.uid === uid && r.periodStart === startKey);
}

/** Total paid to one person in a calendar year, by the date paid. */
export function paidInYear(runs: readonly PayRun[], uid: string, year: number): number {
  const prefix = `${year}-`;
  return round2(
    runs
      .filter((r) => r.uid === uid && r.paidOn.startsWith(prefix) && Number.isFinite(r.gross))
      .reduce((s, r) => s + r.gross, 0),
  );
}

export type ContractorFlag = "employee" | "below" | "approaching" | "needs_1099";

export interface ContractorStatus {
  flag: ContractorFlag;
  /** A 1099 contractor with no W-9 on file. Collect it before the first payment. */
  w9Missing: boolean;
}

/**
 * Where a person stands for the 1099-NEC. `threshold` is the year's filing
 * threshold (lib/cpaPacket.ts contractorThreshold). "approaching" from 75%.
 */
export function contractorStatus(person: PersonPay, paidThisYear: number, threshold: number): ContractorStatus {
  if (person.classification === "w2") return { flag: "employee", w9Missing: false };
  const w9Missing = !person.w9;
  if (paidThisYear >= threshold) return { flag: "needs_1099", w9Missing };
  if (paidThisYear >= threshold * 0.75) return { flag: "approaching", w9Missing };
  return { flag: "below", w9Missing };
}

/** A year's pay, split the way Schedule C wants it: W-2 wages, and 1099 contract labour per person. */
export function yearPayTotals(
  runs: readonly PayRun[],
  year: number,
): { wages: number; contract: number; byPerson: { uid: string; name: string; classification: Classification; paid: number; payments: number }[] } {
  const prefix = `${year}-`;
  const people = new Map<string, { uid: string; name: string; classification: Classification; paid: number; payments: number }>();
  let wages = 0;
  let contract = 0;
  for (const r of runs) {
    if (!r.paidOn.startsWith(prefix) || !Number.isFinite(r.gross) || r.gross <= 0) continue;
    if (r.classification === "w2") wages += r.gross;
    else contract += r.gross;
    const key = `${r.uid}:${r.classification}`;
    const p = people.get(key) ?? { uid: r.uid, name: r.name, classification: r.classification, paid: 0, payments: 0 };
    p.paid += r.gross;
    p.payments += 1;
    people.set(key, p);
  }
  return {
    wages: round2(wages),
    contract: round2(contract),
    byPerson: [...people.values()].map((p) => ({ ...p, paid: round2(p.paid) })).sort((a, b) => b.paid - a.paid),
  };
}
