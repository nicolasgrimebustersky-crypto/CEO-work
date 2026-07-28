"use client";

import { format, isToday } from "date-fns";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { dayKey, jobsOnDay, weekDays } from "@/lib/schedule";
import type { Job } from "@/lib/types";
import { JobBlock } from "./JobBlock";
import type { DropTarget } from "./useJobDrag";

/**
 * Seven day columns. Dropping a job into a column moves it to that date and
 * keeps its time of day — changing the hour is what the day view is for.
 */
export function WeekView({
  anchor,
  jobs,
  draggingJobId,
  dropTarget,
  onOpenJob,
  onOpenDay,
  onPressStart,
  onPressCancel,
  registerScroller,
}: {
  anchor: Date;
  jobs: Job[];
  draggingJobId: string | null;
  dropTarget: DropTarget | null;
  onOpenJob: (job: Job) => void;
  onOpenDay: (day: Date) => void;
  onPressStart: (event: React.PointerEvent<HTMLElement>, job: Job) => void;
  onPressCancel: () => void;
  registerScroller: (element: HTMLElement | null) => void;
}) {
  const { byId } = useCustomers();
  const days = weekDays(anchor);

  return (
    // Registered so a drag near the left/right edge scrolls the week — seven
    // columns do not fit on a phone, so the target day is often off screen.
    <div ref={registerScroller} className="h-full overflow-x-auto overflow-y-auto">
      <div className="flex h-full min-w-[46rem]">
        {days.map((day) => {
          const key = dayKey(day);
          const dayJobs = jobsOnDay(jobs, day);
          const isDropTarget = dropTarget?.dayKey === key;

          return (
            <div
              key={key}
              data-drop-day={key}
              className={`flex min-w-0 flex-1 flex-col border-r border-line ${
                isDropTarget ? "bg-accent/10 outline outline-2 -outline-offset-2 outline-accent" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                className="sticky top-0 z-10 border-b border-line bg-surface px-2 py-2 text-center"
              >
                <span className="block text-[11px] font-black text-muted">
                  {format(day, "EEE")}
                </span>
                <span
                  className={`block text-lg font-black ${
                    isToday(day) ? "text-accent" : "text-ink"
                  }`}
                >
                  {format(day, "d")}
                </span>
              </button>

              <div className="flex flex-1 flex-col gap-1 p-1">
                {dayJobs.length === 0 ? (
                  <span className="mt-2 block text-center text-[11px] font-bold text-muted/70">
                    —
                  </span>
                ) : null}
                {dayJobs.map((job) => (
                  <JobBlock
                    key={job.id}
                    job={job}
                    customer={byId.get(job.customerId)}
                    compact
                    dragging={draggingJobId === job.id}
                    onOpen={onOpenJob}
                    onPressStart={(event) => onPressStart(event, job)}
                    onPressCancel={onPressCancel}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
