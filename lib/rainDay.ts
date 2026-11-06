/**
 * Rain day: move a washed-out day's jobs to the next open days, in one tap.
 *
 *   Open day   a work day (Mon–Sat by default) that isn't itself rained
 *              out, with room left: the jobs already on it plus this one
 *              fit inside the day's capacity.
 *   Time       a job keeps its time of day — 9:00 on Tuesday is 9:00 on
 *              Wednesday — so customers aren't told a new time as well.
 *   Cadence    a recurring plan visit is never pushed onto or past the
 *              customer's next regular visit. If there is no room before
 *              it, the visit is skipped instead ("see you next Tuesday"),
 *              and the plan carries on its usual days. The plan itself is
 *              never shifted.
 *   One-offs   look up to `maxDaysOut` ahead; if nothing fits they are left
 *              where they are and listed for a person to place.
 *
 * Jobs are placed earliest first, so the first customer of the rained-out
 * day gets the first open slot.
 *
 * Free of imports, so every rule is a test.
 */

export interface RainJob {
  id: string;
  customerId: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** Minutes after midnight it starts. */
  startMinutes: number;
  durationMinutes: number;
  status: string;
  /** Set for a recurring plan visit. */
  planDate: string | null;
}

export interface RainOptions {
  /** 0 = Sunday … 6 = Saturday. */
  workDays: readonly number[];
  /** Minutes of work one day holds, all crew together. */
  capacityMinutes: number;
  /** How far ahead a one-off job may go. */
  maxDaysOut: number;
}

export const RAIN_DEFAULTS: RainOptions = { workDays: [1, 2, 3, 4, 5, 6], capacityMinutes: 10 * 60, maxDaysOut: 14 };

export interface RainMove {
  jobId: string;
  customerId: string;
  from: string;
  to: string;
  startMinutes: number;
}

export interface RainSkip {
  jobId: string;
  customerId: string;
  from: string;
  /** The customer's next regular visit, which stays. */
  nextVisit: string;
}

export interface RainPlan {
  moves: RainMove[];
  skips: RainSkip[];
  /** One-off jobs with no room in reach: a person places these. */
  unplaced: { jobId: string; customerId: string; from: string }[];
}

const DAY_MS = 86_400_000;

function dayNum(date: string): number {
  return Math.round(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY_MS);
}

function dateOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function weekday(day: number): number {
  return new Date(day * DAY_MS).getUTCDay();
}

/** Jobs that still need doing. */
const LIVE = new Set(["scheduled", "in_progress"]);

/**
 * @param rainedOut   the day (or days) washed out, "YYYY-MM-DD".
 * @param jobs        every job from the first rained-out day through at least
 *                    `maxDaysOut` after the last, so each day's load is known.
 * @param nextVisit   for each plan visit on a rained-out day, the customer's
 *                    next regular visit after it ("YYYY-MM-DD"), or null.
 */
export function planRainDay(
  rainedOut: readonly string[],
  jobs: readonly RainJob[],
  nextVisit: Readonly<Record<string, string | null>>,
  options: RainOptions = RAIN_DEFAULTS,
): RainPlan {
  const rained = new Set(rainedOut);
  const toMove = jobs
    // Only jobs not yet started: one under way is being done, rain or not.
    .filter((j) => rained.has(j.date) && j.status === "scheduled")
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.id.localeCompare(b.id));

  // What each day already holds, leaving out the jobs being moved off it.
  const load = new Map<string, number>();
  const moving = new Set(toMove.map((j) => j.id));
  for (const j of jobs) {
    if (moving.has(j.id) || !LIVE.has(j.status)) continue;
    load.set(j.date, (load.get(j.date) ?? 0) + Math.max(0, j.durationMinutes));
  }

  const plan: RainPlan = { moves: [], skips: [], unplaced: [] };
  const work = new Set(options.workDays);

  for (const job of toMove) {
    const from = dayNum(job.date);
    const limitDate = job.planDate ? nextVisit[job.id] ?? null : null;
    // A plan visit must land before the next regular one.
    const last = limitDate ? Math.min(dayNum(limitDate) - 1, from + options.maxDaysOut) : from + options.maxDaysOut;

    let placed: string | null = null;
    for (let d = from + 1; d <= last; d += 1) {
      const date = dateOf(d);
      if (!work.has(weekday(d)) || rained.has(date)) continue;
      const used = load.get(date) ?? 0;
      // An empty day takes a job even if the job alone is longer than a day.
      if (used > 0 && used + job.durationMinutes > options.capacityMinutes) continue;
      placed = date;
      load.set(date, used + Math.max(0, job.durationMinutes));
      break;
    }

    if (placed) {
      plan.moves.push({ jobId: job.id, customerId: job.customerId, from: job.date, to: placed, startMinutes: job.startMinutes });
    } else if (job.planDate && limitDate) {
      plan.skips.push({ jobId: job.id, customerId: job.customerId, from: job.date, nextVisit: limitDate });
    } else {
      plan.unplaced.push({ jobId: job.id, customerId: job.customerId, from: job.date });
    }
  }
  return plan;
}

/**
 * One text per customer: someone with two jobs on the washed-out day hears
 * about both in one message, not two.
 */
export function customersToText(plan: RainPlan): string[] {
  const seen = new Set<string>();
  for (const m of plan.moves) seen.add(m.customerId);
  for (const s of plan.skips) seen.add(s.customerId);
  return [...seen].filter(Boolean);
}
