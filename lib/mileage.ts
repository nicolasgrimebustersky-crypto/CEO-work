/**
 * Business mileage: the trips, the IRS rate, and which drives log themselves.
 *
 * Trips log themselves from the job taps (driveToJob below):
 *   - "En route": the phone's location at that moment is where the drive
 *     starts, the job is where it ends, and the trip is logged right then —
 *     road miles from Google, reason filled in.
 *   - "Start" with no "En route" first: the drive is taken from the person's
 *     previous job that day, so a skipped tap doesn't lose the miles.
 *   - By hand, for the drive the taps missed.
 * A phone can't follow GPS in the background from a web app, and doesn't
 * need to: the IRS wants each business trip's date, miles and purpose, which
 * one location per tap gives.
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

export const TRIP_SOURCES = ["job_to_job", "gps_gap", "home_to_job", "manual", "en_route"] as const;
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

/** Close enough to a job's pin to count as still being at it. */
export const AT_JOB_METERS = 200;
/** Shorter than this is moving the truck, not a trip. */
export const MIN_TRIP_METERS = 500;

/* ------------------------------------------------------- automatic trips */

export type DriveDecision =
  | {
      kind: "log";
      from: Place & { label: string };
      source: "en_route" | "job_to_job" | "home_to_job";
      reason: string;
      /** The previous job, when the drive came from one. */
      fromJobId: string | null;
    }
  | { kind: "skip"; reason: "no_destination" | "commute" | "no_origin" | "too_short" };

/**
 * Whether the drive to a job is a business trip, and where it started.
 *
 *   - It has to end at the job's pin.
 *   - The day's first drive is commuting unless home is the business's main
 *     office (IRS: home to a work site is personal when there is no regular
 *     office elsewhere and home isn't the principal place of business) —
 *     wherever the person set off from. That is the safe reading; an
 *     accountant can add a drive the rule leaves out, but not unpick one it
 *     should not have claimed.
 *   - Later drives start at the phone's location when there is one: the job
 *     before if they are still at it, or wherever they are (the supply yard,
 *     the dump) — that detour is part of the business day. Without a
 *     location, or with one already at this job (the tap came late), the
 *     previous job's pin.
 *   - A drive that ends where it starts is moving the truck, not a trip.
 */
export function driveToJob(input: {
  to: Place & { label: string };
  /** Where the phone was when "En route" was tapped, if it could tell. */
  gps: Place | null;
  /** This person's last job today before this one, if any. */
  previousJob: (Place & { id: string; label: string }) | null;
  home: Place | null;
  homeIsMainOffice: boolean;
}): DriveDecision {
  const { to, gps, previousJob, home, homeIsMainOffice } = input;
  if (!hasFix(to)) return { kind: "skip", reason: "no_destination" };

  let decision: DriveDecision;
  if (!previousJob || !hasFix(previousJob)) {
    if (!homeIsMainOffice) return { kind: "skip", reason: "commute" };
    const start = hasFix(gps) ? gps : hasFix(home) ? home : null;
    if (!start) return { kind: "skip", reason: "no_origin" };
    decision = {
      kind: "log",
      from: { lat: start.lat, lng: start.lng, label: "Office" },
      source: "home_to_job",
      reason: `Office → Job: ${to.label}`,
      fromJobId: null,
    };
  } else if (hasFix(gps) && metersBetween(gps, previousJob) > AT_JOB_METERS && metersBetween(gps, to) > AT_JOB_METERS) {
    decision = {
      kind: "log",
      from: { lat: gps.lat, lng: gps.lng, label: "On the way" },
      source: "en_route",
      reason: `After ${previousJob.label} → Job: ${to.label}`,
      fromJobId: previousJob.id,
    };
  } else {
    decision = {
      kind: "log",
      from: { lat: previousJob.lat, lng: previousJob.lng, label: previousJob.label },
      source: "job_to_job",
      reason: `Job: ${previousJob.label} → ${to.label}`,
      fromJobId: previousJob.id,
    };
  }
  if (metersBetween(decision.from, to) < MIN_TRIP_METERS) return { kind: "skip", reason: "too_short" };
  return decision;
}

/** The key an automatic trip is logged under: one per person per job, so a second tap corrects it. */
export function autoTripKey(jobId: string): string {
  return `auto:${jobId}`;
}
