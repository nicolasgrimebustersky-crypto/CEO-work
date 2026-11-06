"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useJobs } from "@/components/providers/JobsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Spinner } from "@/components/ui/Spinner";
import { estimateMinutes, googleRouteUrl, hasFix, planRoute, retime, type RoutePoint } from "@/lib/dayRoute";
import { updateJob } from "@/lib/db/jobs";
import { formatDriveMinutes, useTravelMatrix } from "@/lib/driveTime";
import { customerName } from "@/lib/format";
import { directionsUrl, isApplePlatform } from "@/lib/maps";
import type { Customer, Job } from "@/lib/types";

/**
 * Today's jobs in the best order to drive them, from where the crew is.
 *
 * The start is, in order of preference: the job somebody is on right now
 * (started and not finished), a job they pick ("Start from here"), or the
 * phone's own location. Everything not yet done today is reordered from
 * there — see lib/dayRoute.ts for how — using Google's road times when the
 * Distance Matrix answers and straight-line estimates when it does not.
 *
 * Planning changes nothing. "Drive it" opens the route in Google Maps;
 * "Update today's times" re-times the jobs to the new order, after showing
 * exactly which times move, and sends no texts.
 */
export function DayRoutePanel() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  if (!apiKey) return <DayRoute />;
  return (
    <APIProvider apiKey={apiKey} libraries={["routes"]}>
      <DayRoute />
    </APIProvider>
  );
}

type Scope = "mine" | "all";
type StartChoice = { kind: "auto" } | { kind: "here" } | { kind: "job"; jobId: string };

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function DayRoute() {
  const { jobs, loading } = useJobs();
  const { byId: customersById } = useCustomers();
  const { author } = useTeam();
  const uid = author?.uid ?? "";

  const [scope, setScope] = useState<Scope>("mine");
  const [startChoice, setStartChoice] = useState<StartChoice>({ kind: "auto" });
  const [here, setHere] = useState<RoutePoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const today = useMemo(() => {
    return jobs
      .filter((job) => sameDay(job.scheduledStart.toDate(), now))
      .filter((job) => job.status === "scheduled" || job.status === "in_progress")
      .filter((job) => scope === "all" || job.assignedTo.length === 0 || job.assignedTo.includes(uid))
      .sort((a, b) => a.scheduledStart.toMillis() - b.scheduledStart.toMillis());
  }, [jobs, now, scope, uid]);

  const customerOf = (job: Job): Customer | undefined => customersById.get(job.customerId);
  const pointOf = (job: Job): RoutePoint => {
    const c = customerOf(job);
    return c ? { lat: c.lat, lng: c.lng } : { lat: 0, lng: 0 };
  };

  // The job being worked right now, if any: started, not finished.
  const current = useMemo(
    () => today.find((job) => job.status === "in_progress" && hasFix(pointOf(job))) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today, customersById],
  );

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateError("This phone can't share its location.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocateError("Couldn't get your location — pick the job you're at instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  // With nobody on a job, the phone's location is the natural start: ask once.
  useEffect(() => {
    if (!current && startChoice.kind !== "job" && !here && !locating && !locateError) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, startChoice.kind]);

  // Resolve the start.
  const startJob: Job | null =
    startChoice.kind === "job"
      ? today.find((j) => j.id === startChoice.jobId) ?? null
      : startChoice.kind === "auto"
        ? current
        : null;
  const startPoint: RoutePoint | null = startJob
    ? pointOf(startJob)
    : here ?? (today[0] ? pointOf(today[0]) : null);
  const startLabel = startJob
    ? `${customerOf(startJob) ? customerName(customerOf(startJob)!) : "this job"}${startJob.status === "in_progress" ? " (you're on it)" : ""}`
    : here
      ? "where you are now"
      : "the first job on the schedule";

  const toRoute = useMemo(() => today.filter((job) => job.id !== startJob?.id), [today, startJob]);
  const placedPoints = useMemo(
    () => toRoute.map(pointOf).filter(hasFix),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toRoute, customersById],
  );
  const matrixPoints = useMemo(
    () => (startPoint && hasFix(startPoint) ? [startPoint, ...placedPoints] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startPoint?.lat, startPoint?.lng, placedPoints],
  );
  const { matrix, source } = useTravelMatrix(matrixPoints);

  const plan = useMemo(() => {
    if (!startPoint) return null;
    const stops = toRoute.map((job) => ({ id: job.id, ...pointOf(job) }));
    return planRoute(startPoint, stops, matrix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPoint?.lat, startPoint?.lng, toRoute, matrix, customersById]);

  const ordered = useMemo(
    () => (plan ? plan.order.map((id) => toRoute.find((j) => j.id === id)!).filter(Boolean) : []),
    [plan, toRoute],
  );

  /** Drive minutes into each ordered job, from the start or the job before. */
  const legs = useMemo(() => {
    if (!startPoint) return [];
    const pts = [startPoint, ...ordered.map(pointOf)];
    const indexOf = (p: RoutePoint) => matrixPoints.findIndex((m) => m.lat === p.lat && m.lng === p.lng);
    return ordered.map((_, i) => {
      const a = pts[i];
      const b = pts[i + 1];
      if (!hasFix(a) || !hasFix(b)) return null;
      const ia = indexOf(a);
      const ib = indexOf(b);
      if (matrix && ia >= 0 && ib >= 0) return matrix[ia][ib];
      return estimateMinutes(a, b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, startPoint?.lat, startPoint?.lng, matrix, matrixPoints]);

  // The proposed times: back to back from the start, with the drives between.
  const proposal = useMemo(() => {
    if (ordered.length === 0) return [];
    const FIVE = 5 * 60_000;
    const nowRounded = new Date(Math.ceil(Date.now() / FIVE) * FIVE);
    const earliest = new Date(Math.min(...ordered.map((j) => j.scheduledStart.toMillis())));
    // From a job you're at: when it is booked to end, or now if that has passed.
    const base = startJob
      ? new Date(Math.max(startJob.scheduledEnd.toMillis(), nowRounded.getTime()))
      : new Date(Math.max(earliest.getTime(), nowRounded.getTime()));
    const firstLeg = legs[0] ?? 0;
    const first = startJob ? new Date(Math.ceil((base.getTime() + firstLeg * 60_000) / FIVE) * FIVE) : base;
    return retime(
      ordered.map((job) => ({
        id: job.id,
        durationMinutes: (job.scheduledEnd.toMillis() - job.scheduledStart.toMillis()) / 60_000,
      })),
      legs.map((l) => l ?? 0),
      first,
    );
  }, [ordered, legs, startJob]);

  const changes = proposal.filter((p) => {
    const job = toRoute.find((j) => j.id === p.id);
    return job && Math.abs(job.scheduledStart.toMillis() - p.start.getTime()) >= 60_000;
  });

  async function applyTimes() {
    if (!author) return;
    setSaving(true);
    try {
      for (const change of changes) {
        await updateJob(change.id, { scheduledStart: change.start, scheduledEnd: change.end }, author);
      }
      setSaved(`${changes.length} job${changes.length === 1 ? "" : "s"} re-timed.`);
      setConfirming(false);
    } catch (err) {
      setSaved(err instanceof Error ? err.message : "Could not update the times.");
    } finally {
      setSaving(false);
    }
  }

  const apple = typeof navigator !== "undefined" && isApplePlatform(navigator.userAgent);
  const driveUrl = googleRouteUrl(startJob ? pointOf(startJob) : here, ordered.map(pointOf));
  const saves = plan ? Math.round(plan.givenMinutes - plan.minutes) : 0;

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="px-4 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={scope === "mine"} onClick={() => setScope("mine")}>
          My jobs
        </Chip>
        <Chip active={scope === "all"} onClick={() => setScope("all")}>
          Everyone&apos;s
        </Chip>
      </div>

      {today.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-line bg-surface-2 p-4">
          <p className="text-base font-bold text-ink">No jobs left today</p>
          <p className="mt-1 text-base font-semibold text-muted">
            Anything scheduled and not finished today shows up here, in the best order to drive it.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-3 rounded-2xl border border-accent/60 bg-accent/10 p-3">
            <p className="text-sm font-bold tracking-wide text-accent uppercase">Best route today</p>
            <p className="mt-0.5 text-2xl font-extrabold text-ink">
              {ordered.length} job{ordered.length === 1 ? "" : "s"}
              {plan ? ` · ${formatDriveMinutes(Math.max(1, Math.round(plan.minutes)))} driving` : ""}
            </p>
            <p className="mt-1 text-sm font-semibold text-muted">
              Starting from {startLabel}.
              {saves >= 2 ? ` Saves about ${formatDriveMinutes(saves)} over the schedule's order.` : " The schedule's order is already about the best."}
              {source === "google" ? " Road times from Google." : " Drive times estimated."}
            </p>
            {locating ? <p className="mt-1 text-sm font-semibold text-muted">Finding where you are…</p> : null}
            {locateError ? <p className="mt-1 text-sm font-semibold text-warn">{locateError}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {driveUrl ? (
                <a
                  href={driveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap-target inline-flex items-center justify-center rounded-full bg-accent px-4 text-base font-semibold text-accent-ink"
                >
                  Drive it in Google Maps
                </a>
              ) : null}
              {startJob || !here ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStartChoice({ kind: "here" });
                    locate();
                  }}
                >
                  Start from where I am
                </Button>
              ) : null}
            </div>
            {ordered.length > 10 ? (
              <p className="mt-2 text-sm font-semibold text-muted">
                Google Maps links take ten stops; the link covers the first ten.
              </p>
            ) : null}
          </div>

          <ol className="mt-3 flex flex-col gap-2">
            {startJob ? (
              <StopRow
                index={0}
                job={startJob}
                customer={customerOf(startJob)}
                note={startJob.status === "in_progress" ? "You're here" : "Starting here"}
                apple={apple}
              />
            ) : null}
            {ordered.map((job, i) => (
              <StopRow
                key={job.id}
                index={i + 1}
                job={job}
                customer={customerOf(job)}
                note={
                  !hasFix(pointOf(job))
                    ? "No map location — fix the address"
                    : legs[i] != null
                      ? `${formatDriveMinutes(Math.max(1, Math.round(legs[i]!)))} drive`
                      : ""
                }
                apple={apple}
                onStartHere={() => setStartChoice({ kind: "job", jobId: job.id })}
              />
            ))}
          </ol>

          {changes.length > 0 ? (
            <div className="mt-3 rounded-2xl border border-line bg-surface-2 p-3">
              {confirming ? (
                <>
                  <p className="text-base font-bold text-ink">These times would change:</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {changes.map((c) => {
                      const job = toRoute.find((j) => j.id === c.id)!;
                      const customer = customerOf(job);
                      return (
                        <li key={c.id} className="text-sm font-semibold text-muted">
                          <span className="font-bold text-ink">{customer ? customerName(customer) : "Job"}</span>{" "}
                          {timeLabel(job.scheduledStart.toDate())} → {timeLabel(c.start)}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-sm font-semibold text-muted">
                    No texts go out. If a customer was promised a time, keep that job where it is.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>
                      Cancel
                    </Button>
                    <Button full onClick={() => void applyTimes()} disabled={saving}>
                      {saving ? "Updating…" : "Update the times"}
                    </Button>
                  </div>
                </>
              ) : (
                <Button full variant="secondary" onClick={() => setConfirming(true)}>
                  Update today&apos;s times to this order
                </Button>
              )}
            </div>
          ) : null}
          {saved ? <p className="mt-2 text-sm font-semibold text-money">{saved}</p> : null}
        </>
      )}
    </div>
  );
}

function StopRow({
  index,
  job,
  customer,
  note,
  apple,
  onStartHere,
}: {
  index: number;
  job: Job;
  customer: Customer | undefined;
  note: string;
  apple: boolean;
  onStartHere?: () => void;
}) {
  const nav = customer ? directionsUrl({ lat: customer.lat, lng: customer.lng, address: customer.address }, { apple }) : null;
  return (
    <li className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm font-extrabold text-ink">
          {index === 0 ? "★" : index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold break-words text-ink">
            {customer ? customerName(customer) : "Unknown client"}
          </span>
          <span className="block text-sm font-semibold text-muted">
            {[timeLabel(job.scheduledStart.toDate()), note].filter(Boolean).join(" · ")}
          </span>
          {customer?.address ? (
            <span className="block truncate text-sm font-semibold text-muted">{customer.address}</span>
          ) : null}
        </span>
      </div>
      {onStartHere || nav ? (
        <div className="mt-2 flex gap-2 pl-11">
          {nav ? (
            <a
              href={nav}
              target="_blank"
              rel="noopener noreferrer"
              className="tap-target inline-flex items-center rounded-full bg-surface-3 px-4 text-sm font-bold text-ink"
            >
              Directions
            </a>
          ) : null}
          {onStartHere ? (
            <button
              type="button"
              onClick={onStartHere}
              className="tap-target rounded-full border border-line px-4 text-sm font-semibold text-muted hover:text-ink"
            >
              I&apos;m at this job
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
