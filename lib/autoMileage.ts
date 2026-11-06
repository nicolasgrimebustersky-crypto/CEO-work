"use client";

/**
 * Logs the drive to a job from the job's own taps, so nobody types miles.
 *
 *   "En route"  one location fix from the phone, then the trip to this job
 *                (driveToJob decides whether it counts and where it started).
 *   "Start"      only when nobody tapped "En route" for this job: the trip
 *                from the person's previous job today. The phone is at the
 *                job by then, so its location says nothing about the drive.
 *
 * Never in the way of the job: it runs after the customer was texted and the
 * job stamped, and a failure here costs a trip, not a step. The trip is keyed
 * per person per job, so tapping "En route" again corrects it rather than
 * adding a second one.
 */

import { getMileageHome, logTrip } from "@/lib/db/mileage";
import { localDate } from "@/lib/expenses";
import { customerName } from "@/lib/format";
import { autoTripKey, driveToJob, hasFix, type Place } from "@/lib/mileage";
import type { Author, Customer, Job } from "@/lib/types";

const FIX_TIMEOUT_MS = 8000;

/** One position from the phone, or null if it can't or won't say. */
export function currentPlace(): Promise<Place | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: FIX_TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

const workedAt = (job: Job) => (job.finishedAt ?? job.startedAt)?.toMillis() ?? 0;

/** This person's most recent job started today, other than this one. */
export function previousJobToday(uid: string, jobId: string, jobs: readonly Job[], today = localDate()): Job | null {
  let best: Job | null = null;
  for (const j of jobs) {
    if (j.id === jobId || !j.assignedTo.includes(uid) || !j.startedAt) continue;
    if (localDate(j.startedAt.toDate()) !== today) continue;
    if (!best || workedAt(j) > workedAt(best)) best = j;
  }
  return best;
}

export interface AutoTripResult {
  miles: number;
  estimated: boolean;
}

export async function logDriveToJob(input: {
  step: "en_route" | "started";
  job: Job;
  jobs: readonly Job[];
  customersById: ReadonlyMap<string, Customer>;
  author: Author;
  homeIsMainOffice: boolean;
  measure: (a: Place, b: Place) => Promise<{ miles: number; estimated: boolean }>;
}): Promise<AutoTripResult | null> {
  const { step, job, jobs, customersById, author, homeIsMainOffice, measure } = input;
  // "Start" stands in only for a missing "En route": that tap already logged
  // the drive, or decided it didn't count.
  if (step === "started" && job.enRouteAt) return null;

  const customer = customersById.get(job.customerId);
  if (!customer || !hasFix(customer)) return null;
  const to = { lat: customer.lat, lng: customer.lng, label: customerName(customer) };

  const prev = previousJobToday(author.uid, job.id, jobs);
  const prevCustomer = prev ? customersById.get(prev.customerId) : undefined;
  const previousJob =
    prev && prevCustomer && hasFix(prevCustomer)
      ? { id: prev.id, lat: prevCustomer.lat, lng: prevCustomer.lng, label: customerName(prevCustomer) }
      : null;

  const [gps, home] = await Promise.all([
    step === "en_route" ? currentPlace() : Promise.resolve(null),
    homeIsMainOffice ? getMileageHome(author.uid) : Promise.resolve(null),
  ]);

  const decision = driveToJob({ to, gps, previousJob, home, homeIsMainOffice });
  if (decision.kind === "skip") return null;

  const { miles, estimated } = await measure(decision.from, to);
  if (!(miles > 0) || miles >= 2000) return null;
  await logTrip(
    {
      date: localDate(),
      miles,
      reason: decision.reason,
      source: decision.source,
      estimated,
      from: decision.from,
      to,
      jobIds: decision.fromJobId ? [decision.fromJobId, job.id] : [job.id],
      suggestionKey: autoTripKey(job.id),
    },
    author,
  );
  return { miles, estimated };
}
