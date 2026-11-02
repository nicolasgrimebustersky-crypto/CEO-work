/**
 * Pay periods, and what each person did inside one.
 *
 * The owner asked for the pay-period view another field-service app has:
 * Everyone / Sales / Technicians, a frequency, a start day, and the dates of
 * the period on screen. How the crew is actually paid — by the hour, by the
 * job, on commission — is the owner's call and lives outside the app; this
 * puts the numbers that feed it in one place, per person, per period:
 *
 *   technicians  jobs finished, hours on site, the share of revenue
 *   sales        estimates sent, estimates won and what they were worth
 *
 * Pure and import-free, so every rule is tested by calling it.
 */

export const FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
};

/** 0 = Sunday … 6 = Saturday, as Date.getDay() counts. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAY_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface PaySchedule {
  frequency: Frequency;
  /** Weekly and every-2-weeks only. */
  startsOn: Weekday;
}

export const DEFAULT_SCHEDULE: PaySchedule = { frequency: "weekly", startsOn: 1 };

export interface Period {
  start: Date;
  /** Exclusive: the first moment of the next period. */
  end: Date;
}

/**
 * Every-two-weeks periods need a fixed starting point or "this period" would
 * depend on when you looked. Jan 4 2026 is a Sunday; the anchor is moved to
 * the chosen weekday from there.
 */
const BIWEEKLY_ANCHOR = new Date(2026, 0, 4);

function startOfDay(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Whole calendar days from a to b, immune to daylight-saving hours. */
function dayDiff(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86_400_000);
}

/** The period containing `date`. */
export function periodContaining(date: Date, schedule: PaySchedule): Period {
  const day = startOfDay(date);
  switch (schedule.frequency) {
    case "weekly": {
      const back = (day.getDay() - schedule.startsOn + 7) % 7;
      const start = addDays(day, -back);
      return { start, end: addDays(start, 7) };
    }
    case "biweekly": {
      const anchor = addDays(BIWEEKLY_ANCHOR, (schedule.startsOn - BIWEEKLY_ANCHOR.getDay() + 7) % 7);
      const offset = ((dayDiff(anchor, day) % 14) + 14) % 14;
      const start = addDays(day, -offset);
      return { start, end: addDays(start, 14) };
    }
    case "semimonthly": {
      const first = day.getDate() <= 15;
      const start = new Date(day.getFullYear(), day.getMonth(), first ? 1 : 16);
      const end = first
        ? new Date(day.getFullYear(), day.getMonth(), 16)
        : new Date(day.getFullYear(), day.getMonth() + 1, 1);
      return { start, end };
    }
    case "monthly":
      return {
        start: new Date(day.getFullYear(), day.getMonth(), 1),
        end: new Date(day.getFullYear(), day.getMonth() + 1, 1),
      };
  }
}

/** The period `steps` before (negative) or after (positive) this one. */
export function shiftPeriod(period: Period, steps: number, schedule: PaySchedule): Period {
  let current = period;
  const direction = steps < 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(steps); i += 1) {
    current =
      direction > 0
        ? periodContaining(current.end, schedule)
        : periodContaining(addDays(current.start, -1), schedule);
  }
  return current;
}

/** Length in days, for the "7 days" field. */
export function periodDays(period: Period): number {
  return dayDiff(period.start, period.end);
}

interface Stamp {
  toMillis(): number;
}

export interface PayJob {
  status: string;
  price: number;
  visitType?: string | null;
  assignedTo: readonly string[];
  completedAt?: Stamp | null;
  startedAt?: Stamp | null;
  finishedAt?: Stamp | null;
  scheduledStart: Stamp;
  scheduledEnd: Stamp;
}

export interface PayDocument {
  kind: string;
  status: string;
  total: number;
  createdBy: string;
  sentAt?: Stamp | null;
  issuedAt?: Stamp | null;
}

export interface PersonPeriod {
  uid: string;
  /** Technician side. */
  jobs: number;
  hours: number;
  /** Each job's price split evenly between the people on it. */
  revenue: number;
  /** Sales side. */
  estimatesSent: number;
  estimatesWon: number;
  wonValue: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function within(stamp: Stamp | null | undefined, period: Period): boolean {
  if (!stamp || typeof stamp.toMillis !== "function") return false;
  const ms = stamp.toMillis();
  return Number.isFinite(ms) && ms >= period.start.getTime() && ms < period.end.getTime();
}

/**
 * Hours on site: from Start to Finish when both were tapped, otherwise the
 * scheduled length. Capped at 16 so a job nobody finished does not pay out a
 * week.
 */
function hoursFor(job: PayJob): number {
  const from = job.startedAt?.toMillis();
  const to = job.finishedAt?.toMillis();
  const span =
    typeof from === "number" && typeof to === "number" && to > from
      ? to - from
      : job.scheduledEnd.toMillis() - job.scheduledStart.toMillis();
  const hours = span / 3_600_000;
  return Number.isFinite(hours) && hours > 0 ? Math.min(hours, 16) : 0;
}

export function periodSummary(
  uids: readonly string[],
  jobs: readonly PayJob[],
  documents: readonly PayDocument[],
  period: Period,
): PersonPeriod[] {
  const rows = new Map<string, PersonPeriod>(
    uids.map((uid) => [
      uid,
      { uid, jobs: 0, hours: 0, revenue: 0, estimatesSent: 0, estimatesWon: 0, wonValue: 0 },
    ]),
  );

  for (const job of jobs) {
    if (job.status !== "complete" || !within(job.completedAt, period)) continue;
    const crew = job.assignedTo.filter((uid) => rows.has(uid));
    if (crew.length === 0) continue;
    const billable = !job.visitType || job.visitType === "service";
    const price = billable && Number.isFinite(job.price) && job.price > 0 ? job.price : 0;
    const hours = hoursFor(job);
    for (const uid of crew) {
      const row = rows.get(uid)!;
      row.jobs += 1;
      row.hours += hours;
      row.revenue += price / crew.length;
    }
  }

  for (const document of documents) {
    if (document.kind !== "estimate") continue;
    const row = rows.get(document.createdBy);
    if (!row) continue;
    if (document.status === "draft" || document.status === "void") continue;
    if (!within(document.sentAt ?? document.issuedAt, period)) continue;
    row.estimatesSent += 1;
    if (document.status === "accepted") {
      row.estimatesWon += 1;
      row.wonValue += Number.isFinite(document.total) && document.total > 0 ? document.total : 0;
    }
  }

  return [...rows.values()].map((row) => ({
    ...row,
    hours: Math.round(row.hours * 10) / 10,
    revenue: round2(row.revenue),
    wonValue: round2(row.wonValue),
  }));
}
