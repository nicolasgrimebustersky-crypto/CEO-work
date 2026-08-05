"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import {
  addDays,
  addMonths,
  addWeeks,
  format,
  isSameDay,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { useCallback, useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useJobs } from "@/components/providers/JobsProvider";
import { useNotify } from "@/components/providers/NotificationsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Spinner } from "@/components/ui/Spinner";
import { rescheduleJob } from "@/lib/db/jobs";
import { customerName } from "@/lib/format";
import { jobRescheduledText } from "@/lib/messages";
import {
  atMinutes,
  dayFromKey,
  minutesFromMidnight,
  snapToSlot,
  type CalendarView,
} from "@/lib/schedule";
import { SERVICE_LABEL } from "@/lib/status";
import { trySendSms } from "@/lib/smsClient";
import type { Job } from "@/lib/types";
import { DayView } from "./DayView";
import { JobSheet } from "./JobSheet";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { useJobDrag, type DropTarget } from "./useJobDrag";

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export function ScheduleScreen() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  // The Maps script is only needed for real road drive times in the day view.
  // Without a key the day view still works and falls back to estimates.
  if (!apiKey) return <Schedule />;
  return (
    <APIProvider apiKey={apiKey} libraries={["routes"]}>
      <Schedule />
    </APIProvider>
  );
}

function Schedule() {
  const { jobs, byId: jobsById, loading, error } = useJobs();
  const { byId: customersById } = useCustomers();
  const { author, users, colorFor } = useTeam();
  const notify = useNotify();

  const [view, setView] = useState<CalendarView>("day");
  const [anchor, setAnchor] = useState(() => new Date());
  const [mineOnly, setMineOnly] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [slotStart, setSlotStart] = useState<Date | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);


  const visibleJobs = useMemo(() => {
    if (!mineOnly || !author) return jobs;
    return jobs.filter((job) => job.assignedTo.includes(author.uid));
  }, [jobs, mineOnly, author]);

  /**
   * Dropping a block reschedules it. A day-level drop (week and month views)
   * keeps the original time of day; a slot-level drop (day view) sets it.
   */
  const handleDrop = useCallback(
    async (jobId: string, target: DropTarget) => {
      const job = jobsById.get(jobId);
      if (!job || !author) return;

      const currentStart = job.scheduledStart.toDate();
      const targetDay = dayFromKey(target.dayKey);
      const minutes =
        target.minutes === null
          ? minutesFromMidnight(currentStart)
          : snapToSlot(target.minutes);
      const newStart = atMinutes(targetDay, minutes);

      if (newStart.getTime() === currentStart.getTime()) return;

      try {
        await rescheduleJob(job, newStart, author);

        const customer = customersById.get(job.customerId);
        const label = customer ? customerName(customer) : "A job";

        await notify({
          type: "job_rescheduled",
          body: `${label} · ${SERVICE_LABEL[job.serviceType]} · ${format(newStart, "EEE MMM d, h:mm a")}`,
          customerId: job.customerId,
          jobId: job.id,
        });

        const smsError = await trySendSms(
          job.customerId,
          jobRescheduledText(SERVICE_LABEL[job.serviceType], newStart),
          "job_rescheduled",
        );
        setToast(
          smsError
            ? `Moved to ${format(newStart, "EEE h:mm a")}, but the text didn't send: ${smsError}`
            : `Moved to ${format(newStart, "EEE h:mm a")} — customer texted.`,
        );
      } catch (err) {
        setToast(err instanceof Error ? err.message : "Could not move that job.");
      }
    },
    [jobsById, customersById, author, notify],
  );

  const { drag, didJustDrag, startPress, cancelPress, registerScroller } = useJobDrag(
    (jobId, target) => void handleDrop(jobId, target),
  );

  const onPressStart = useCallback(
    (event: React.PointerEvent<HTMLElement>, job: Job) => {
      const customer = customersById.get(job.customerId);
      startPress(event, job.id, customer ? customerName(customer) : "Job");
    },
    [startPress, customersById],
  );

  function openJob(job: Job) {
    // A press that became a drag must not also open the sheet on release —
    // the browser still fires a click on the block you just dropped.
    if (drag || didJustDrag()) return;
    setEditingJob(job);
    setSlotStart(undefined);
    setSheetOpen(true);
  }

  function openSlot(day: Date, minutes: number) {
    if (drag || didJustDrag()) return;
    setEditingJob(null);
    setSlotStart(atMinutes(day, minutes));
    setSheetOpen(true);
  }

  function openDay(day: Date) {
    setAnchor(day);
    setView("day");
  }

  function shift(direction: -1 | 1) {
    setAnchor((current) => {
      if (view === "day") return addDays(current, direction);
      if (view === "week") return addWeeks(current, direction);
      return addMonths(current, direction);
    });
  }

  const rangeLabel = useMemo(() => {
    if (view === "day") {
      return isSameDay(anchor, new Date())
        ? `Today · ${format(anchor, "EEE MMM d")}`
        : format(anchor, "EEEE MMM d");
    }
    if (view === "week") {
      const start = startOfWeek(anchor, { weekStartsOn: 0 });
      const end = endOfWeek(anchor, { weekStartsOn: 0 });
      return `${format(start, "MMM d")} – ${format(end, "MMM d")}`;
    }
    return format(anchor, "MMMM yyyy");
  }, [view, anchor]);

  return (
    // `relative` anchors the floating "new job" button to this screen rather
    // than to the document.
    <div className="relative flex h-full flex-col">
      <ScreenHeader title="Schedule" subtitle={rangeLabel}>
        {/* Wraps rather than overflowing: on a 360px phone the date controls
            and the view toggle do not fit on one line. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous"
            className="tap-target flex size-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-xl font-extrabold text-ink"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setAnchor(new Date())}
            className="tap-target rounded-xl border border-line bg-surface-2 px-3 text-sm font-bold text-ink"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next"
            className="tap-target flex size-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-xl font-extrabold text-ink"
          >
            ›
          </button>

          <div className="ml-auto flex overflow-hidden rounded-xl border border-line">
            {VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={view === option.value}
                onClick={() => setView(option.value)}
                className={`tap-target px-3 text-sm font-bold ${
                  view === option.value
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-2 text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={!mineOnly}
            onClick={() => setMineOnly(false)}
            className={`tap-target rounded-full border px-3.5 text-sm font-bold ${
              !mineOnly
                ? "border-accent bg-accent text-accent-ink"
                : "border-line bg-surface-2 text-ink"
            }`}
          >
            All jobs
          </button>
          <button
            type="button"
            aria-pressed={mineOnly}
            onClick={() => setMineOnly(true)}
            className={`tap-target rounded-full border px-3.5 text-sm font-bold ${
              mineOnly
                ? "border-accent bg-accent text-accent-ink"
                : "border-line bg-surface-2 text-ink"
            }`}
          >
            My jobs
          </button>

          <div className="ml-auto flex items-center gap-2">
            {users.map((user) => (
              <span key={user.uid} className="flex items-center gap-1.5">
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: colorFor(user.uid) }}
                />
                <span className="text-sm font-bold text-muted">
                  {user.displayName.split(" ")[0]}
                </span>
              </span>
            ))}
          </div>
        </div>
      </ScreenHeader>

      {error ? (
        <p
          role="alert"
          className="m-3 rounded-xl border border-danger/60 bg-danger/15 px-3 py-3 text-base font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1">
        {loading ? (
          <Spinner label="Loading schedule…" />
        ) : view === "day" ? (
          <DayView
            day={anchor}
            jobs={visibleJobs}
            draggingJobId={drag?.jobId ?? null}
            dropTarget={drag?.target ?? null}
            onOpenJob={openJob}
            onOpenSlot={openSlot}
            onPressStart={onPressStart}
            onPressCancel={cancelPress}
            registerScroller={registerScroller}
          />
        ) : view === "week" ? (
          <WeekView
            anchor={anchor}
            jobs={visibleJobs}
            draggingJobId={drag?.jobId ?? null}
            dropTarget={drag?.target ?? null}
            onOpenJob={openJob}
            onOpenDay={openDay}
            onPressStart={onPressStart}
            onPressCancel={cancelPress}
            registerScroller={registerScroller}
          />
        ) : (
          <MonthView
            anchor={anchor}
            jobs={visibleJobs}
            draggingJobId={drag?.jobId ?? null}
            dropTarget={drag?.target ?? null}
            onOpenJob={openJob}
            onOpenDay={openDay}
            onPressStart={onPressStart}
            onPressCancel={cancelPress}
          />
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-end px-3">
        <button
          type="button"
          onClick={() => {
            setEditingJob(null);
            setSlotStart(undefined);
            setSheetOpen(true);
          }}
          aria-label="New job"
          className="tap-target pointer-events-auto flex size-14 items-center justify-center rounded-full bg-accent text-3xl font-extrabold text-accent-ink shadow-lg"
        >
          +
        </button>
      </div>

      {/* Floating label that follows the finger while dragging. */}
      {drag ? (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border border-accent bg-surface px-2.5 py-1.5 text-sm font-bold text-ink shadow-xl"
          style={{ left: drag.x, top: drag.y - 8 }}
        >
          {drag.label}
          {drag.target?.minutes != null ? (
            <span className="ml-1.5 text-accent">
              {format(atMinutes(new Date(), snapToSlot(drag.target.minutes)), "h:mm a")}
            </span>
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <button
          type="button"
          onClick={() => setToast(null)}
          className="fixed inset-x-3 bottom-24 z-40 rounded-xl border border-line bg-surface px-3 py-3 text-left text-base font-semibold text-ink shadow-xl"
        >
          {toast}
        </button>
      ) : null}

      <JobSheet
        open={sheetOpen}
        job={editingJob}
        defaultStart={slotStart}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
