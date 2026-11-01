/**
 * Booking a job again, once or on a schedule.
 *
 * A pressure-washing customer who wants the house done every spring, or a
 * mowing account every two weeks, used to mean scheduling each visit by hand.
 * This lays out the dates; the caller creates one ordinary job per date, so a
 * repeat visit is a job like any other — editable, movable, cancellable on its
 * own — and nothing else in the app has to learn what a "series" is.
 *
 * Pure and import-free so the dates are tested by calling it. Month steps
 * keep the day of the month and clamp at the end of short months (Jan 31 →
 * Feb 28 → Mar 31, not drifting to the 28th forever).
 */

export const REPEAT_EVERY = ["week", "2weeks", "4weeks", "month", "3months", "year"] as const;
export type RepeatEvery = (typeof REPEAT_EVERY)[number];

export const REPEAT_LABEL: Record<RepeatEvery, string> = {
  week: "Every week",
  "2weeks": "Every 2 weeks",
  "4weeks": "Every 4 weeks",
  month: "Every month",
  "3months": "Every 3 months",
  year: "Every year",
};

/** The most visits one tap may book. Enough for a year of weekly mowing. */
export const MAX_REPEATS = 52;

function addMonthsClamped(base: Date, months: number): Date {
  const result = new Date(base.getTime());
  const day = base.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

function step(base: Date, every: RepeatEvery, n: number): Date {
  switch (every) {
    case "week":
    case "2weeks":
    case "4weeks": {
      const weeks = every === "week" ? 1 : every === "2weeks" ? 2 : 4;
      const result = new Date(base.getTime());
      // setDate keeps the wall-clock time across a daylight-saving change,
      // where adding milliseconds would move a 9am job to 8am in November.
      result.setDate(result.getDate() + weeks * 7 * n);
      return result;
    }
    case "month":
      return addMonthsClamped(base, n);
    case "3months":
      return addMonthsClamped(base, 3 * n);
    case "year":
      return addMonthsClamped(base, 12 * n);
  }
}

export interface Visit {
  start: Date;
  end: Date;
}

/**
 * The next `count` visits after the one given, keeping its length and time of
 * day. The original visit is not included — it already exists.
 */
export function repeatVisits(first: Visit, every: RepeatEvery, count: number): Visit[] {
  const total = Math.max(0, Math.min(MAX_REPEATS, Math.floor(count)));
  const length = first.end.getTime() - first.start.getTime();
  const visits: Visit[] = [];
  for (let n = 1; n <= total; n += 1) {
    const start = step(first.start, every, n);
    visits.push({ start, end: new Date(start.getTime() + length) });
  }
  return visits;
}
