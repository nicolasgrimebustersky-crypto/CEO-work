"use client";

import { format, isToday } from "date-fns";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { dayKey, isInMonth, jobsOnDay, monthGridDays } from "@/lib/schedule";
import type { Job } from "@/lib/types";
import { assigneeStripe } from "./JobBlock";
import type { DropTarget } from "./useJobDrag";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function MonthView({
  anchor,
  jobs,
  draggingJobId,
  dropTarget,
  onOpenJob,
  onOpenDay,
  onPressStart,
  onPressCancel,
}: {
  anchor: Date;
  jobs: Job[];
  draggingJobId: string | null;
  dropTarget: DropTarget | null;
  onOpenJob: (job: Job) => void;
  onOpenDay: (day: Date) => void;
  onPressStart: (event: React.PointerEvent<HTMLElement>, job: Job) => void;
  onPressCancel: () => void;
}) {
  const { byId } = useCustomers();
  const { colorFor } = useTeam();
  const days = monthGridDays(anchor);

  return (
    <div className="flex h-full flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-line bg-surface">
        {WEEKDAYS.map((label, index) => (
          <div
            key={`${label}-${index}`}
            className="py-1.5 text-center text-xs font-black text-muted"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const key = dayKey(day);
          const dayJobs = jobsOnDay(jobs, day);
          const outside = !isInMonth(day, anchor);
          const isDropTarget = dropTarget?.dayKey === key;

          return (
            <div
              key={key}
              data-drop-day={key}
              onClick={() => onOpenDay(day)}
              className={`min-h-0 overflow-hidden border-r border-b border-line p-1 ${
                outside ? "bg-base/60" : "bg-base"
              } ${isDropTarget ? "outline outline-2 -outline-offset-2 outline-accent" : ""}`}
            >
              <div
                className={`mb-0.5 text-[11px] font-black ${
                  isToday(day)
                    ? "text-accent"
                    : outside
                      ? "text-muted/60"
                      : "text-ink"
                }`}
              >
                {format(day, "d")}
              </div>

              <div className="flex flex-col gap-0.5">
                {dayJobs.slice(0, 3).map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onPointerDown={(event) => onPressStart(event, job)}
                    onPointerUp={onPressCancel}
                    onPointerLeave={onPressCancel}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenJob(job);
                    }}
                    style={{
                      touchAction: "none",
                      opacity: draggingJobId === job.id ? 0.35 : 1,
                      background: assigneeStripe(
                        job.assignedTo.map((uid) => colorFor(uid)),
                      ),
                    }}
                    className="block h-3.5 w-full truncate rounded-sm px-1 text-left text-[9px] font-black text-black/80"
                  >
                    {byId.get(job.customerId)?.lastName ||
                      format(job.scheduledStart.toDate(), "h a")}
                  </button>
                ))}
                {dayJobs.length > 3 ? (
                  <span className="text-[9px] font-black text-muted">
                    +{dayJobs.length - 3}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
