"use client";

import { addMinutes, format } from "date-fns";
import { useEffect, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { scheduleAsJob } from "@/lib/db/documents";
import type { BusinessDocument } from "@/lib/documents";
import { formatMoneyExact } from "@/lib/format";
import { DEFAULT_JOB_MINUTES } from "@/lib/schedule";
import { SERVICE_LABEL } from "@/lib/status";
import type { Author } from "@/lib/types";

function toLocalInput(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

/** Tomorrow at 9, which is when a two-person crew actually starts. */
function defaultStart(): Date {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  day.setHours(9, 0, 0, 0);
  return day;
}

/**
 * Putting an accepted estimate on the calendar.
 *
 * It asks for the one thing the estimate does not already know: when. The
 * customer, the service and the price all come across untouched — re-entering
 * a price you already agreed is how the calendar and the invoice end up
 * disagreeing about what the work was worth, and the number the customer said
 * yes to is the one that should be on the job.
 */
export function ScheduleJobSheet({
  open,
  document: estimate,
  author,
  onClose,
  onScheduled,
}: {
  open: boolean;
  document: BusinessDocument;
  author: Author | null;
  onClose: () => void;
  onScheduled: (jobId: string) => void;
}) {
  const { users } = useTeam();
  const [start, setStart] = useState(() => toLocalInput(defaultStart()));
  const [end, setEnd] = useState(() =>
    toLocalInput(addMinutes(defaultStart(), DEFAULT_JOB_MINUTES)),
  );
  const [assigned, setAssigned] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to whoever is looking at it. A job assigned to nobody is a job
  // neither of you thinks is yours.
  useEffect(() => {
    if (open && author) setAssigned([author.uid]);
  }, [open, author]);

  // Moving the start drags the end with it, keeping the length you set rather
  // than snapping back to the default — otherwise every edit to the start time
  // silently rewrites a duration you had already chosen.
  function onStartChange(next: string) {
    const previous = new Date(start);
    const parsed = new Date(next);
    setStart(next);
    if (Number.isNaN(parsed.getTime())) return;

    const currentEnd = new Date(end);
    const kept =
      Number.isNaN(previous.getTime()) || Number.isNaN(currentEnd.getTime())
        ? DEFAULT_JOB_MINUTES
        : Math.max(15, (currentEnd.getTime() - previous.getTime()) / 60000);
    setEnd(toLocalInput(addMinutes(parsed, kept)));
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  const problem =
    Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())
      ? "Pick a date and a time."
      : endDate <= startDate
        ? "It has to finish after it starts."
        : null;

  async function save() {
    if (!author || problem) return;
    setBusy(true);
    setError(null);
    try {
      const jobId = await scheduleAsJob(
        estimate,
        { start: startDate, end: endDate, assignedTo: assigned },
        author,
      );
      onScheduled(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not schedule that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      title="Put it on the calendar"
      onClose={onClose}
      footer={
        <Button full onClick={() => void save()} disabled={busy || problem !== null}>
          {busy ? "Scheduling…" : "Schedule the job"}
        </Button>
      }
    >
      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <p className="text-base font-bold text-ink">{estimate.customerName}</p>
        <p className="mt-0.5 text-sm font-semibold text-muted">
          {SERVICE_LABEL[estimate.serviceType]} ·{" "}
          {formatMoneyExact(estimate.total)} · from estimate {estimate.number}
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <TextField
          label="Starts"
          type="datetime-local"
          value={start}
          onChange={(e) => onStartChange(e.target.value)}
        />
        <TextField
          label="Ends"
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>

      <div className="mt-4">
        <span className="mb-1.5 block text-base font-semibold text-ink">
          Who is doing it?
        </span>
        <div className="flex flex-wrap gap-2">
          {users.map((user) => (
            <Chip
              key={user.uid}
              active={assigned.includes(user.uid)}
              onClick={() =>
                setAssigned(
                  assigned.includes(user.uid)
                    ? assigned.filter((uid) => uid !== user.uid)
                    : [...assigned, user.uid],
                )
              }
            >
              {user.displayName}
            </Chip>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm font-semibold text-muted">
        {problem ??
          `The price and the work come straight from the estimate — nothing to retype.`}
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
