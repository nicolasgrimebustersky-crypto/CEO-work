"use client";

import { format } from "date-fns";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { createJob } from "@/lib/db/jobs";
import {
  MAX_REPEATS,
  REPEAT_EVERY,
  REPEAT_LABEL,
  repeatVisits,
  type RepeatEvery,
} from "@/lib/recurrence";
import { routes } from "@/lib/routes";
import type { Job } from "@/lib/types";

/**
 * What usually comes after a visit, one tap each: price the next piece of
 * work, bill this one, book the customer again, or put them on a schedule.
 *
 * Laid out as the grid of big tiles the owner pointed at in another
 * field-service app. "On my way" is not here because it already sits in the
 * on-site row above, where it stamps the job and texts the customer.
 */
export function JobNextSteps({ job }: { job: Job }) {
  const [repeat, setRepeat] = useState<"once" | "recurring" | null>(null);

  return (
    <div>
      <p className="mb-2 text-sm font-bold text-muted">Next steps</p>
      <div className="grid grid-cols-2 gap-2">
        <Tile href={routes.newDocument("estimate", job.customerId)} label="Create estimate">
          <DocIcon />
        </Tile>
        <Tile href={routes.newDocument("invoice", job.customerId)} label="Create invoice">
          <InvoiceIcon />
        </Tile>
        <Tile onClick={() => setRepeat("once")} label="Book again">
          <CalendarPlusIcon />
        </Tile>
        <Tile onClick={() => setRepeat("recurring")} label="Make recurring">
          <RepeatIcon />
        </Tile>
      </div>

      <RepeatSheet
        job={job}
        mode={repeat}
        onClose={() => setRepeat(null)}
      />
    </div>
  );
}

function Tile({
  label,
  href,
  onClick,
  children,
}: {
  label: string;
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <span className="flex size-11 items-center justify-center rounded-full bg-accent/15 text-accent">
        {children}
      </span>
      <span className="text-sm font-bold text-ink">{label}</span>
    </>
  );
  const className =
    "tap-target flex flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-surface-2 px-2 py-4 text-center active:bg-surface-3";
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

function toLocalDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Books copies of this job — one on a chosen date, or a run of them on a
 * schedule. Each copy is an ordinary job with the same customer, services,
 * price, crew and notes, so it can be moved or cancelled on its own.
 *
 * No text goes to the customer from here: a dozen "you're booked" messages at
 * once would be noise. Each visit's on-site row still sends its own texts on
 * the day.
 */
function RepeatSheet({
  job,
  mode,
  onClose,
}: {
  job: Job;
  mode: "once" | "recurring" | null;
  onClose: () => void;
}) {
  const { author } = useTeam();
  const firstStart = job.scheduledStart.toDate();
  const length = job.scheduledEnd.toMillis() - job.scheduledStart.toMillis();

  const [every, setEvery] = useState<RepeatEvery>("2weeks");
  const [count, setCount] = useState(4);
  const [onceDate, setOnceDate] = useState(() => {
    const next = new Date(firstStart);
    next.setDate(next.getDate() + 7);
    return toLocalDate(next);
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visits = useMemo(() => {
    if (mode === "once") {
      const [y, m, d] = onceDate.split("-").map(Number);
      if (!y || !m || !d) return [];
      const start = new Date(firstStart);
      start.setFullYear(y, m - 1, d);
      return [{ start, end: new Date(start.getTime() + length) }];
    }
    return repeatVisits({ start: firstStart, end: new Date(firstStart.getTime() + length) }, every, count);
  }, [mode, onceDate, every, count, firstStart, length]);

  const close = () => {
    setResult(null);
    setError(null);
    onClose();
  };

  const book = async () => {
    if (!author || saving || visits.length === 0) return;
    setSaving(true);
    setError(null);
    let booked = 0;
    try {
      for (const visit of visits) {
        await createJob(
          {
            customerId: job.customerId,
            serviceType: job.serviceType,
            serviceTypes: job.serviceTypes,
            subServices: job.subServices,
            visitType: job.visitType,
            scheduledStart: visit.start,
            scheduledEnd: visit.end,
            price: job.price,
            assignedTo: job.assignedTo,
            jobNotes: job.jobNotes,
          },
          author,
        );
        booked += 1;
      }
      setResult(
        booked === 1
          ? `Booked for ${format(visits[0].start, "EEE MMM d 'at' h:mm a")}.`
          : `Booked ${booked} visits, ${format(visits[0].start, "MMM d")} to ${format(
              visits[visits.length - 1].start,
              "MMM d, yyyy",
            )}.`,
      );
    } catch {
      // Say how far it got: the visits already booked are real and should not
      // be booked a second time by pressing again.
      setError(
        booked === 0
          ? "Could not book. Check your signal and try again."
          : `Booked ${booked} of ${visits.length} before the connection dropped. Check the calendar before trying again.`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={mode !== null}
      title={mode === "once" ? "Book again" : "Make recurring"}
      onClose={close}
      footer={
        result ? (
          <Button full onClick={close}>
            Done
          </Button>
        ) : (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button full onClick={() => void book()} disabled={saving || visits.length === 0}>
              {saving
                ? "Booking…"
                : visits.length === 1
                  ? "Book visit"
                  : `Book ${visits.length} visits`}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <p className="rounded-xl border border-money/60 bg-money/10 px-3 py-3 text-base font-semibold text-ink">
          {result}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-semibold text-muted">
            Same customer, services, price, crew and notes, at{" "}
            {format(firstStart, "h:mm a")}. Each visit can be moved or cancelled on its own.
          </p>

          {mode === "once" ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-muted">Date</span>
              <input
                type="date"
                value={onceDate}
                onChange={(event) => setOnceDate(event.target.value)}
                className="tap-target rounded-xl border border-line bg-surface-2 px-3 text-base text-ink"
              />
            </label>
          ) : (
            <>
              <div>
                <p className="mb-1.5 text-sm font-semibold text-muted">How often</p>
                <div className="flex flex-wrap gap-2">
                  {REPEAT_EVERY.map((option) => (
                    <Chip key={option} active={every === option} onClick={() => setEvery(option)}>
                      {REPEAT_LABEL[option]}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-semibold text-muted">How many more visits</p>
                <div className="flex items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setCount((value) => Math.max(1, value - 1))}
                    aria-label="One fewer visit"
                  >
                    −
                  </Button>
                  <span className="w-10 text-center text-2xl font-extrabold text-ink tabular-nums">
                    {count}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => setCount((value) => Math.min(MAX_REPEATS, value + 1))}
                    aria-label="One more visit"
                  >
                    +
                  </Button>
                </div>
              </div>
            </>
          )}

          {visits.length > 0 ? (
            <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
              <p className="mb-1 text-sm font-bold text-muted">
                {visits.length === 1 ? "Visit" : `${visits.length} visits`}
              </p>
              <ul className="flex flex-col gap-0.5 text-base font-semibold text-ink">
                {visits.slice(0, 6).map((visit) => (
                  <li key={visit.start.getTime()}>{format(visit.start, "EEE, MMM d, yyyy")}</li>
                ))}
                {visits.length > 6 ? (
                  <li className="text-muted">…and {visits.length - 6} more</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

const ICON = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function DocIcon() {
  return (
    <svg {...ICON}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

function InvoiceIcon() {
  return (
    <svg {...ICON}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function CalendarPlusIcon() {
  return (
    <svg {...ICON}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18M12 13v5M9.5 15.5h5" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg {...ICON}>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </svg>
  );
}
