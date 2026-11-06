/**
 * Business mileage: the trips, the IRS rate, and when to ask about a drive.
 *
 * Three ways a trip gets logged, and none of them is silent:
 *   - Job to job: the day's jobs in the order they were worked suggest a trip
 *     between each pair, road miles from Google, reason filled in
 *     ("Job: Smith → Jones"). One tap logs it.
 *   - GPS gap: when the app opens and the person's last saved location was at
 *     a job, the drive from there to here is offered — "X mi since your last
 *     job — business?" — and logged only on Yes.
 *   - By hand.
 *
 * Home to the first job is commuting, which the IRS does not allow, unless
 * home is the business's main office; the owner says which.
 *
 * The rate is a dated table, not one figure per year: the IRS raised 2026's
 * rate mid-year (72.5¢ from 1 January, 76¢ from 1 July, Announcement
 * 2026-11), and a trip is deducted at the rate in force on its date.
 *
 * Standard mileage and actual vehicle costs cannot both be claimed for the
 * same vehicle; the owner picks one (MileageMethod) and the tax estimate
 * follows it.
 *
 * Free of imports so it is tested by calling it.
 */

export interface MileageRate {
  /** First day this rate applies, "YYYY-MM-DD". */
  from: string;
  /** Cents per business mile. */
  cents: number;
}

/** Newest last. Add a row when the IRS announces a rate; nothing else changes. */
export const MILEAGE_RATES: readonly MileageRate[] = [
  { from: "2025-01-01", cents: 70 },
  { from: "2026-01-01", cents: 72.5 },
  { from: "2026-07-01", cents: 76 },
];

/** Cents per mile in force on `date` ("YYYY-MM-DD"). Before the table starts: its first rate. */
export function rateFor(date: string, rates: readonly MileageRate[] = MILEAGE_RATES): number {
  let cents = rates[0]?.cents ?? 0;
  for (const rate of rates) {
    if (rate.from <= date) cents = rate.cents;
  }
  return cents;
}

export const MILEAGE_METHODS = ["standard", "actual"] as const;
export type MileageMethod = (typeof MILEAGE_METHODS)[number];

export const MILEAGE_METHOD_LABEL: Record<MileageMethod, string> = {
  standard: "Standard mileage rate",
  actual: "Actual truck costs (gas, repairs…)",
};

export const TRIP_SOURCES = ["job_to_job", "gps_gap", "home_to_job", "manual"] as const;
export type TripSource = (typeof TRIP_SOURCES)[number];

export interface TripLike {
  date: string;
  miles: number;
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Miles and the standard-rate deduction for trips dated in `year`, each at its own date's rate. */
export function mileageTotals(trips: readonly TripLike[], year: number): { miles: number; deduction: number; count: number } {
  let miles = 0;
  let deduction = 0;
  let count = 0;
  for (const trip of trips) {
    if (!trip.date.startsWith(`${year}-`)) continue;
    const m = Number.isFinite(trip.miles) && trip.miles > 0 ? trip.miles : 0;
    if (m === 0) continue;
    miles += m;
    deduction += (m * rateFor(trip.date)) / 100;
    count += 1;
  }
  return { miles: round2(miles), deduction: round2(deduction), count };
}

/* --------------------------------------------------------------- geometry */

export interface Place {
  lat: number;
  lng: number;
}

export function hasFix(p: Place | null | undefined): p is Place {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0);
}

export function metersBetween(a: Place, b: Place): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Road miles when Google cannot answer: straight line, roads winding 35% more. */
export function estimateRoadMiles(a: Place, b: Place): number {
  return round2((metersBetween(a, b) * 1.35) / 1609.34);
}

/* ------------------------------------------------------- job-to-job trips */

export interface WorkedJob extends Place {
  id: string;
  /** The client's name, for the reason line. */
  label: string;
  /** When the work started, epoch ms — the order the day was driven in. */
  startedAt: number;
}

export interface SuggestedTrip {
  /** Stable, so a logged suggestion is recognised and not offered again. */
  key: string;
  date: string;
  from: Place & { label: string };
  to: Place & { label: string };
  reason: string;
  source: TripSource;
  jobIds: string[];
}

/**
 * The trips a person's day implies: home to the first job (only if home is
 * the main office), then each job to the next, in the order they started.
 * Jobs with no map location are skipped rather than guessed.
 */
export function suggestTrips(
  date: string,
  jobs: readonly WorkedJob[],
  home: (Place & { label?: string }) | null,
  homeIsMainOffice: boolean,
): SuggestedTrip[] {
  const worked = jobs.filter(hasFix).slice().sort((a, b) => a.startedAt - b.startedAt);
  const out: SuggestedTrip[] = [];
  if (homeIsMainOffice && hasFix(home) && worked.length > 0) {
    const first = worked[0];
    out.push({
      key: `${date}:home:${first.id}`,
      date,
      from: { lat: home.lat, lng: home.lng, label: home.label || "Home office" },
      to: { lat: first.lat, lng: first.lng, label: first.label },
      reason: `Office → Job: ${first.label}`,
      source: "home_to_job",
      jobIds: [first.id],
    });
  }
  for (let i = 1; i < worked.length; i += 1) {
    const a = worked[i - 1];
    const b = worked[i];
    out.push({
      key: `${date}:${a.id}:${b.id}`,
      date,
      from: { lat: a.lat, lng: a.lng, label: a.label },
      to: { lat: b.lat, lng: b.lng, label: b.label },
      reason: `Job: ${a.label} → ${b.label}`,
      source: "job_to_job",
      jobIds: [a.id, b.id],
    });
  }
  return out;
}

/* ------------------------------------------------------------- GPS gap */

export const GAP_MAX_MS = 4 * 60 * 60 * 1000;
/** Close enough to a job's pin to count as having been at it. */
export const AT_JOB_METERS = 200;
/** Close enough to home to count as having driven home. */
export const NEAR_HOME_METERS = 300;
/** Shorter than this is moving the truck, not a trip. */
export const MIN_TRIP_METERS = 500;

export type GapDecision =
  | { kind: "ask"; fromJob: WorkedJob; straightMeters: number }
  | { kind: "skip"; reason: "no_last" | "too_long" | "not_at_job" | "near_home" | "too_short" };

/**
 * Whether to ask "X mi since your last job — business?" on opening the app.
 * Asks only when the last saved position was at one of the jobs, under four
 * hours ago, the drive was more than a few hundred metres, and it did not end
 * at home (a drive home is commuting). Everything else is skipped; the person
 * can still log it by hand.
 */
export function gapDecision(input: {
  last: (Place & { at: number }) | null;
  now: Place & { at: number };
  jobs: readonly WorkedJob[];
  home: Place | null;
}): GapDecision {
  const { last, now, jobs, home } = input;
  if (!last || !hasFix(last)) return { kind: "skip", reason: "no_last" };
  if (now.at - last.at > GAP_MAX_MS || now.at < last.at) return { kind: "skip", reason: "too_long" };
  let nearest: WorkedJob | null = null;
  let best = Infinity;
  for (const job of jobs) {
    if (!hasFix(job)) continue;
    const d = metersBetween(last, job);
    if (d < best) {
      best = d;
      nearest = job;
    }
  }
  if (!nearest || best > AT_JOB_METERS) return { kind: "skip", reason: "not_at_job" };
  if (hasFix(home) && metersBetween(now, home) <= NEAR_HOME_METERS) return { kind: "skip", reason: "near_home" };
  const straight = metersBetween(last, now);
  if (straight < MIN_TRIP_METERS) return { kind: "skip", reason: "too_short" };
  return { kind: "ask", fromJob: nearest, straightMeters: straight };
}
