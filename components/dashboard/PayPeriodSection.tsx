"use client";

import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { formatMoney } from "@/lib/format";
import {
  DEFAULT_SCHEDULE,
  FREQUENCIES,
  FREQUENCY_LABEL,
  WEEKDAY_LABEL,
  periodContaining,
  periodDays,
  periodSummary,
  shiftPeriod,
  type Frequency,
  type PayDocument,
  type PayJob,
  type PaySchedule,
  type Weekday,
} from "@/lib/payPeriods";

type Audience = "everyone" | "sales" | "technicians";

const STORAGE_KEY = "gb.paySchedule";

/** The schedule is a viewing preference, so it lives on the device. */
function readSchedule(): PaySchedule {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<PaySchedule> | null;
    if (
      raw &&
      (FREQUENCIES as readonly string[]).includes(String(raw.frequency)) &&
      Number.isInteger(raw.startsOn) &&
      (raw.startsOn as number) >= 0 &&
      (raw.startsOn as number) <= 6
    ) {
      return { frequency: raw.frequency as Frequency, startsOn: raw.startsOn as Weekday };
    }
  } catch {
    // Private window or blocked storage: the default is fine.
  }
  return DEFAULT_SCHEDULE;
}

function scheduleLabel(schedule: PaySchedule): string {
  if (schedule.frequency === "weekly" || schedule.frequency === "biweekly") {
    const start = WEEKDAY_LABEL[schedule.startsOn].slice(0, 3);
    const end = WEEKDAY_LABEL[(schedule.startsOn + 6) % 7].slice(0, 3);
    return `${FREQUENCY_LABEL[schedule.frequency]} (${start}–${end})`;
  }
  return FREQUENCY_LABEL[schedule.frequency];
}

/**
 * What each person did in a pay period — the numbers the owner pays from.
 *
 * Laid out after the pay-period settings in the owner's reference app:
 * Everyone / Sales / Technicians, then frequency, start day and length, then
 * the dates. Arrows step through periods. How pay is worked out from these
 * numbers stays the owner's call; nothing here computes wages.
 */
export function PayPeriodSection({
  jobs,
  documents,
}: {
  jobs: readonly PayJob[];
  documents: readonly PayDocument[];
}) {
  const { users, colorFor } = useTeam();
  const [schedule, setSchedule] = useState<PaySchedule>(DEFAULT_SCHEDULE);
  const [steps, setSteps] = useState(0);
  const [audience, setAudience] = useState<Audience>("everyone");
  const [editing, setEditing] = useState(false);

  useEffect(() => setSchedule(readSchedule()), []);

  const update = (next: PaySchedule) => {
    setSchedule(next);
    setSteps(0);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not saved; it still applies for this visit.
    }
  };

  const period = useMemo(
    () => shiftPeriod(periodContaining(new Date(), schedule), steps, schedule),
    [schedule, steps],
  );
  const rows = useMemo(
    () => periodSummary(users.map((user) => user.uid), jobs, documents, period),
    [users, jobs, documents, period],
  );
  const lastDay = new Date(period.end.getTime() - 1);
  const weekBased = schedule.frequency === "weekly" || schedule.frequency === "biweekly";

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setEditing((open) => !open)}
        aria-expanded={editing}
        className="flex w-full items-baseline justify-between gap-2 text-left"
      >
        <h2 className="text-lg font-bold text-ink">Pay period</h2>
        <span className="text-sm font-semibold text-muted">
          {scheduleLabel(schedule)} {editing ? "▴" : "▾"}
        </span>
      </button>

      <div className="mt-2 inline-flex rounded-2xl border border-line bg-surface-2 p-1">
        {(["everyone", "sales", "technicians"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setAudience(option)}
            aria-pressed={audience === option}
            className={`rounded-xl px-3 py-1.5 text-sm font-bold capitalize ${
              audience === option ? "bg-surface-3 text-ink" : "text-muted"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {editing ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-muted">Frequency</span>
            <select
              value={schedule.frequency}
              onChange={(event) => update({ ...schedule, frequency: event.target.value as Frequency })}
              className="tap-target rounded-2xl border border-line bg-surface-2 px-2 text-sm font-semibold text-ink"
            >
              {FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {FREQUENCY_LABEL[frequency]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-muted">Starts on</span>
            <select
              value={schedule.startsOn}
              disabled={!weekBased}
              onChange={(event) =>
                update({ ...schedule, startsOn: Number(event.target.value) as Weekday })
              }
              className="tap-target rounded-2xl border border-line bg-surface-2 px-2 text-sm font-semibold text-ink disabled:opacity-50"
            >
              {WEEKDAY_LABEL.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold text-muted">Length</span>
            <span className="tap-target flex items-center rounded-2xl border border-line bg-surface-2 px-3 text-sm font-semibold text-ink">
              {periodDays(period)} <span className="ml-1 text-muted">days</span>
            </span>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setSteps((value) => value - 1)}
          aria-label="Previous pay period"
          className="tap-target rounded-full border border-line bg-surface-2 px-3 text-lg font-bold text-ink"
        >
          ‹
        </button>
        <p className="text-base font-bold text-ink">
          {format(period.start, "MMM d")} – {format(lastDay, "MMM d")}
          {steps === 0 ? <span className="ml-2 text-sm font-semibold text-muted">current</span> : null}
        </p>
        <button
          type="button"
          onClick={() => setSteps((value) => Math.min(0, value + 1))}
          disabled={steps === 0}
          aria-label="Next pay period"
          className="tap-target rounded-full border border-line bg-surface-2 px-3 text-lg font-bold text-ink disabled:opacity-40"
        >
          ›
        </button>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => {
          const user = users.find((entry) => entry.uid === row.uid);
          return (
            <li key={row.uid} className="rounded-2xl border border-line bg-surface-2 p-3">
              <p className="flex items-center gap-2 text-base font-bold text-ink">
                <span className="size-2.5 rounded-full" style={{ background: colorFor(row.uid) }} />
                {user?.displayName ?? "Crew member"}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {audience !== "sales" ? (
                  <>
                    <Figure label="Jobs done" value={String(row.jobs)} />
                    <Figure label="Hours on site" value={row.hours.toFixed(1)} />
                    <Figure label="Revenue share" value={formatMoney(row.revenue)} money />
                  </>
                ) : null}
                {audience !== "technicians" ? (
                  <>
                    <Figure label="Estimates sent" value={String(row.estimatesSent)} />
                    <Figure label="Won" value={String(row.estimatesWon)} />
                    <Figure label="Won value" value={formatMoney(row.wonValue)} money />
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs font-semibold text-muted">
        Hours use the Start and Finish taps when both were pressed, otherwise the scheduled time. A
        job worked by two people splits its price between them.
      </p>
    </section>
  );
}

function Figure({ label, value, money = false }: { label: string; value: string; money?: boolean }) {
  return (
    <div>
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className={`text-lg font-extrabold tabular-nums ${money ? "text-money" : "text-ink"}`}>{value}</p>
    </div>
  );
}
