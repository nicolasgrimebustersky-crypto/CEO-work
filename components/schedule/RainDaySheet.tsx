"use client";

import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";

import { useNotify } from "@/components/providers/NotificationsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { rainDelayJob } from "@/lib/db/jobs";
import { customerName } from "@/lib/format";
import { rainDayText } from "@/lib/messages";
import { isQuietHour, quietHoursLabel } from "@/lib/notifications/quietHours";
import { customersToText, planRainDay, RAIN_DEFAULTS, type RainJob, type RainOptions } from "@/lib/rainDay";
import { servicesLabel } from "@/lib/serviceText";
import { trySendSms } from "@/lib/smsClient";
import type { Customer, Job } from "@/lib/types";
import { visitPhrase } from "@/lib/visitTypes";

const PREFS_KEY = "rainDay.options";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function atLocal(date: string, minutes: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
}

/** Work days and day length are a per-phone preference; the defaults suit most crews. */
function loadOptions(): RainOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<RainOptions> | null;
    if (raw && Array.isArray(raw.workDays) && typeof raw.capacityMinutes === "number") {
      return { ...RAIN_DEFAULTS, workDays: raw.workDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6), capacityMinutes: raw.capacityMinutes };
    }
  } catch {
    // Blocked storage: defaults.
  }
  return RAIN_DEFAULTS;
}

/**
 * Rain day: one tap moves the day's jobs to the next open days
 * (lib/rainDay.ts), texts each customer once through the normal texting
 * path (consent and STOP are checked there), and tells the crew. It shows
 * the plan first; nothing moves until "Move them".
 */
export function RainDaySheet({
  open,
  day,
  jobs,
  customersById,
  onClose,
  onDone,
}: {
  open: boolean;
  day: Date;
  jobs: readonly Job[];
  customersById: ReadonlyMap<string, Customer>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { author } = useTeam();
  const notify = useNotify();
  const [options, setOptions] = useState<RainOptions>(RAIN_DEFAULTS);
  const [alsoNext, setAlsoNext] = useState(false);
  const [text, setText] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quiet = isQuietHour(new Date());

  useEffect(() => {
    if (!open) return;
    setOptions(loadOptions());
    setAlsoNext(false);
    setText(!isQuietHour(new Date()));
    setError(null);
  }, [open]);

  function saveOptions(next: RainOptions) {
    setOptions(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ workDays: next.workDays, capacityMinutes: next.capacityMinutes }));
    } catch {
      // Not remembered; still used now.
    }
  }

  const rainedOut = useMemo(() => {
    const first = dateKey(day);
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    return alsoNext ? [first, dateKey(next)] : [first];
  }, [day, alsoNext]);

  const plan = useMemo(() => {
    const rainJobs: RainJob[] = jobs.map((j) => {
      const start = j.scheduledStart.toDate();
      return {
        id: j.id,
        customerId: j.customerId,
        date: dateKey(start),
        startMinutes: start.getHours() * 60 + start.getMinutes(),
        durationMinutes: Math.round((j.scheduledEnd.toMillis() - j.scheduledStart.toMillis()) / 60_000),
        status: j.status,
        // No recurring plans here: every job is a one-off.
        planDate: null,
      };
    });
    return planRainDay(rainedOut, rainJobs, {}, options);
  }, [jobs, rainedOut, options]);

  const byId = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const nameOf = (customerId: string) => {
    const c = customersById.get(customerId);
    return c ? customerName(c) : "Customer";
  };
  const total = plan.moves.length + plan.skips.length + plan.unplaced.length;

  async function apply() {
    if (!author) return;
    setBusy(true);
    setError(null);
    try {
      for (const m of plan.moves) {
        const job = byId.get(m.jobId);
        if (job) await rainDelayJob(job, { newStart: atLocal(m.to, m.startMinutes) }, m.from, author);
      }
      for (const s of plan.skips) {
        const job = byId.get(s.jobId);
        if (job) await rainDelayJob(job, { skip: true }, s.from, author);
      }

      await notify({
        type: "job_rescheduled",
        body: `Rain day ${rainedOut.map((d) => format(atLocal(d, 0), "EEE MMM d")).join(" & ")}: ${plan.moves.length} moved${
          plan.skips.length ? `, ${plan.skips.length} skipped to their next visit` : ""
        }${plan.unplaced.length ? `, ${plan.unplaced.length} still to place` : ""}`,
      });

      let texted = 0;
      const failed: string[] = [];
      if (text && !isQuietHour(new Date())) {
        // One text per customer, one at a time, through the normal path.
        for (const customerId of customersToText(plan)) {
          const items = [
            ...plan.moves
              .filter((m) => m.customerId === customerId)
              .map((m) => {
                const job = byId.get(m.jobId);
                return { service: job ? visitPhrase(job.visitType, servicesLabel(job)) : "visit", start: atLocal(m.to, m.startMinutes) };
              }),
            ...plan.skips
              .filter((s) => s.customerId === customerId)
              .map((s) => {
                const job = byId.get(s.jobId);
                return { service: job ? visitPhrase(job.visitType, servicesLabel(job)) : "visit", nextVisit: atLocal(s.nextVisit, 9 * 60) };
              }),
          ];
          const err = await trySendSms(customerId, rainDayText(items), "rain_day");
          if (err) failed.push(`${nameOf(customerId)}: ${err}`);
          else texted += 1;
        }
      }

      onDone(
        `Moved ${plan.moves.length}${plan.skips.length ? `, skipped ${plan.skips.length}` : ""}.` +
          (text ? ` Texted ${texted} customer${texted === 1 ? "" : "s"}.` : " No texts sent.") +
          (failed.length ? ` Not texted — ${failed.join("; ")}` : "") +
          (plan.unplaced.length ? ` ${plan.unplaced.length} job${plan.unplaced.length === 1 ? "" : "s"} still need a day — drag them on the calendar.` : ""),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something didn't save. Check the schedule before trying again.");
    } finally {
      setBusy(false);
    }
  }

  const line = (jobId: string) => {
    const job = byId.get(jobId);
    return job ? `${nameOf(job.customerId)} · ${visitPhrase(job.visitType, servicesLabel(job))}` : "Job";
  };

  return (
    <Sheet
      open={open}
      title={`Rain day — ${format(day, "EEE MMM d")}`}
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button full onClick={() => void apply()} disabled={busy || plan.moves.length + plan.skips.length === 0}>
            {busy ? "Moving…" : `Move ${plan.moves.length + plan.skips.length} job${plan.moves.length + plan.skips.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Chip active={alsoNext} onClick={() => setAlsoNext(!alsoNext)}>
            The next day too
          </Chip>
        </div>

        {total === 0 ? (
          <p className="text-sm font-semibold text-muted">Nothing scheduled and not yet started on this day.</p>
        ) : null}

        {plan.moves.length > 0 ? (
          <section>
            <h3 className="mb-1.5 text-sm font-bold text-ink">Moving</h3>
            <ul className="flex flex-col gap-1.5">
              {plan.moves.map((m) => (
                <li key={m.jobId} className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
                  <p className="font-bold text-ink">{line(m.jobId)}</p>
                  <p className="font-semibold text-muted">
                    {format(atLocal(m.from, m.startMinutes), "EEE")} → <span className="text-money">{format(atLocal(m.to, m.startMinutes), "EEE MMM d, h:mm a")}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {plan.skips.length > 0 ? (
          <section>
            <h3 className="mb-1.5 text-sm font-bold text-ink">Skipping (no room before their next visit)</h3>
            <ul className="flex flex-col gap-1.5">
              {plan.skips.map((s) => (
                <li key={s.jobId} className="rounded-xl border border-warn/50 bg-warn/10 px-3 py-2 text-sm">
                  <p className="font-bold text-ink">{line(s.jobId)}</p>
                  <p className="font-semibold text-muted">Next regular visit {format(atLocal(s.nextVisit, 0), "EEE MMM d")} stays</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {plan.unplaced.length > 0 ? (
          <section>
            <h3 className="mb-1.5 text-sm font-bold text-ink">No room in the next two weeks — place by hand</h3>
            <ul className="flex flex-col gap-1.5">
              {plan.unplaced.map((u) => (
                <li key={u.jobId} className="rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-sm font-bold text-ink">
                  {line(u.jobId)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <label className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
          <input type="checkbox" className="mt-1 size-5" checked={text && !quiet} disabled={quiet} onChange={(e) => setText(e.target.checked)} />
          <span className="text-sm font-semibold text-ink">
            Text each customer their new day ({customersToText(plan).length})
            <span className="block text-xs text-muted">
              {quiet
                ? `It's quiet hours (${quietHoursLabel()}), so no texts now. Move the jobs and text from each job in the morning.`
                : "One text per customer. Anyone who replied STOP or never agreed to texts is skipped."}
            </span>
          </span>
        </label>

        <details>
          <summary className="cursor-pointer text-sm font-bold text-muted">Work days and day length</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {WEEKDAYS.map((label, d) => {
              const on = options.workDays.includes(d);
              return (
                <Chip
                  key={label}
                  active={on}
                  onClick={() => saveOptions({ ...options, workDays: on ? options.workDays.filter((x) => x !== d) : [...options.workDays, d] })}
                >
                  {label}
                </Chip>
              );
            })}
          </div>
          <div className="mt-2">
            <TextField
              label="Hours of work a day holds (whole crew)"
              inputMode="decimal"
              value={String(options.capacityMinutes / 60)}
              onChange={(e) => {
                const h = Number(e.target.value);
                if (Number.isFinite(h) && h > 0 && h <= 24) saveOptions({ ...options, capacityMinutes: Math.round(h * 60) });
              }}
            />
          </div>
        </details>

        {error ? <p className="text-sm font-semibold text-danger">{error}</p> : null}
      </div>
    </Sheet>
  );
}
