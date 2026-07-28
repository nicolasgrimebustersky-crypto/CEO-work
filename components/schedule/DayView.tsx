"use client";

import { format } from "date-fns";
import Link from "next/link";
import { useMemo, useRef } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { UserChip } from "@/components/ui/Chips";
import { formatDriveMinutes, useDriveTimes } from "@/lib/driveTime";
import { customerName, formatMoney } from "@/lib/format";
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  SLOT_MINUTES,
  dayKey,
  formatSlotLabel,
  jobsOnDay,
} from "@/lib/schedule";
import { SERVICE_LABEL } from "@/lib/status";
import type { Job, LatLng } from "@/lib/types";
import { assigneeStripe } from "./JobBlock";
import type { DropTarget } from "./useJobDrag";
import { routes } from "@/lib/routes";

const SLOT_HEIGHT_PX = 44;

export function DayView({
  day,
  jobs,
  draggingJobId,
  dropTarget,
  onOpenJob,
  onOpenSlot,
  onPressStart,
  onPressCancel,
  registerScroller,
}: {
  day: Date;
  jobs: Job[];
  draggingJobId: string | null;
  dropTarget: DropTarget | null;
  onOpenJob: (job: Job) => void;
  onOpenSlot: (day: Date, minutes: number) => void;
  onPressStart: (event: React.PointerEvent<HTMLElement>, job: Job) => void;
  onPressCancel: () => void;
  registerScroller: (element: HTMLElement | null) => void;
}) {
  const { byId } = useCustomers();
  const { colorFor, nameFor } = useTeam();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const dayJobs = jobsOnDay(jobs, day);
  const key = dayKey(day);

  /**
   * Route order is simply scheduled order — that is the order the crew will
   * actually drive it. Cancelled jobs drop out because nobody drives to them.
   */
  const route = useMemo(
    () => dayJobs.filter((job) => job.status !== "cancelled"),
    [dayJobs],
  );

  const stops = useMemo<LatLng[]>(
    () =>
      route
        .map((job) => byId.get(job.customerId))
        .filter((customer): customer is NonNullable<typeof customer> => Boolean(customer))
        .map((customer) => ({ lat: customer.lat, lng: customer.lng })),
    [route, byId],
  );

  const legs = useDriveTimes(stops);
  const totalDriveMinutes = legs.reduce((sum, leg) => sum + leg.minutes, 0);
  const dayRevenue = route
    .filter((job) => job.status !== "cancelled")
    .reduce((sum, job) => sum + job.price, 0);
  const usesEstimates = legs.some((leg) => leg.source === "estimate");

  const slots = Array.from(
    { length: ((DAY_END_HOUR - DAY_START_HOUR) * 60) / SLOT_MINUTES },
    (_, index) => DAY_START_HOUR * 60 + index * SLOT_MINUTES,
  );

  return (
    <div
      ref={(element) => {
        scrollRef.current = element;
        registerScroller(element);
      }}
      className="h-full overflow-y-auto"
    >
      {/* Route summary first: on a work day this is the part you actually read. */}
      <section className="border-b border-line bg-surface px-3 py-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-base font-black text-ink">
            {route.length} {route.length === 1 ? "stop" : "stops"}
          </span>
          <span className="text-base font-bold text-accent">{formatMoney(dayRevenue)}</span>
          {legs.length > 0 ? (
            <span className="text-base font-semibold text-muted">
              {formatDriveMinutes(totalDriveMinutes)} driving
            </span>
          ) : null}
        </div>

        {route.length === 0 ? (
          <p className="mt-2 text-base font-semibold text-muted">
            Nothing scheduled. Tap a time slot below to add a job.
          </p>
        ) : (
          <ol className="mt-3 flex flex-col">
            {route.map((job, index) => {
              const customer = byId.get(job.customerId);
              const leg = index > 0 ? legs[index - 1] : null;
              return (
                <li key={job.id}>
                  {leg ? (
                    <div className="flex items-center gap-2 py-1 pl-3.5 text-sm font-bold text-muted">
                      <span className="h-5 w-0.5 rounded bg-line" />
                      <span>
                        {formatDriveMinutes(leg.minutes)} drive
                        {leg.source === "estimate" ? " (est.)" : ""}
                      </span>
                    </div>
                  ) : null}

                  <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 w-1.5 shrink-0 self-stretch rounded-full"
                      style={{
                        background: assigneeStripe(
                          job.assignedTo.map((uid) => colorFor(uid)),
                        ),
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-base font-bold text-ink">
                          {index + 1}. {customer ? customerName(customer) : "Unknown"}
                        </span>
                        <span className="shrink-0 text-sm font-black text-accent">
                          {formatMoney(job.price)}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-muted">
                        {format(job.scheduledStart.toDate(), "h:mm a")}–
                        {format(job.scheduledEnd.toDate(), "h:mm a")} ·{" "}
                        {SERVICE_LABEL[job.serviceType]}
                        {job.status === "complete" ? " · done" : ""}
                      </p>
                      {customer?.address ? (
                        <p className="truncate text-sm font-semibold text-muted">
                          {customer.address}
                        </p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {job.assignedTo.map((uid) => (
                          <UserChip key={uid} name={nameFor(uid)} color={colorFor(uid)} />
                        ))}
                        {customer ? (
                          <Link
                            href={routes.mapFocus(customer.id)}
                            className="rounded-full border border-line px-2.5 py-1 text-sm font-bold text-ink"
                          >
                            Map
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {usesEstimates && legs.length > 0 ? (
          <p className="mt-2 text-sm font-semibold text-muted">
            Drive times are straight-line estimates. Enable the Distance Matrix API on
            your Maps key for real road times.
          </p>
        ) : null}
      </section>

      {/* Timeline: the drag surface. Drop here to set an exact time. */}
      <div className="relative">
        {slots.map((minutes) => {
          const isDropTarget =
            dropTarget?.dayKey === key && dropTarget.minutes === minutes;
          return (
            <button
              key={minutes}
              type="button"
              data-drop-day={key}
              data-drop-minutes={minutes}
              onClick={() => onOpenSlot(day, minutes)}
              style={{ height: SLOT_HEIGHT_PX }}
              className={`flex w-full items-start gap-2 border-b border-line/60 px-3 text-left ${
                isDropTarget ? "bg-accent/25" : ""
              }`}
            >
              <span className="w-14 shrink-0 pt-1 text-xs font-bold text-muted">
                {minutes % 60 === 0 ? formatSlotLabel(minutes) : ""}
              </span>
            </button>
          );
        })}

        {/* Job blocks are positioned over the slot grid so they can span it. */}
        {dayJobs.map((job) => {
          const start = job.scheduledStart.toDate();
          const end = job.scheduledEnd.toDate();
          const startMinutes = start.getHours() * 60 + start.getMinutes();
          const endMinutes = end.getHours() * 60 + end.getMinutes();
          const top =
            ((startMinutes - DAY_START_HOUR * 60) / SLOT_MINUTES) * SLOT_HEIGHT_PX;
          const height = Math.max(
            ((endMinutes - startMinutes) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
            SLOT_HEIGHT_PX * 0.75,
          );
          // A job outside working hours would render off the grid; clamp it in.
          const clampedTop = Math.max(top, 0);

          const customer = byId.get(job.customerId);

          return (
            <button
              key={job.id}
              type="button"
              onPointerDown={(event) => onPressStart(event, job)}
              onPointerUp={onPressCancel}
              onPointerLeave={onPressCancel}
              onClick={() => onOpenJob(job)}
              style={{
                position: "absolute",
                top: clampedTop,
                height,
                left: "4.5rem",
                right: "0.75rem",
                touchAction: "none",
                opacity: draggingJobId === job.id ? 0.35 : job.status === "cancelled" ? 0.5 : 1,
              }}
              className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface-2 px-2 py-1 text-left"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1.5"
                style={{
                  background: assigneeStripe(job.assignedTo.map((uid) => colorFor(uid))),
                }}
              />
              <span className="truncate pl-2 text-sm font-bold text-ink">
                {customer ? customerName(customer) : "Unknown customer"}
              </span>
              <span className="truncate pl-2 text-xs font-semibold text-muted">
                {SERVICE_LABEL[job.serviceType]} · {formatMoney(job.price)}
              </span>
            </button>
          );
        })}
      </div>

      <p className="px-3 py-4 text-sm font-semibold text-muted">
        Press and hold a job to drag it to a new time. Tap an empty slot to schedule one.
      </p>
    </div>
  );
}
