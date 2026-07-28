"use client";

import { format } from "date-fns";

import { useTeam } from "@/components/providers/TeamProvider";
import { customerName, formatMoney } from "@/lib/format";
import { SERVICE_SHORT_LABEL } from "@/lib/status";
import type { Customer, Job } from "@/lib/types";

/**
 * Jobs are colour-coded by who is assigned. A job assigned to both crew gets a
 * two-stop gradient down its left edge rather than picking one person's colour,
 * so "we're both on this" is visible at a glance.
 */
export function assigneeStripe(colors: string[]): string {
  if (colors.length === 0) return "#35424f";
  if (colors.length === 1) return colors[0];
  return `linear-gradient(180deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
}

interface JobBlockProps {
  job: Job;
  customer: Customer | undefined;
  compact?: boolean;
  dragging?: boolean;
  onOpen: (job: Job) => void;
  onPressStart?: (event: React.PointerEvent<HTMLElement>) => void;
  onPressCancel?: () => void;
  style?: React.CSSProperties;
}

export function JobBlock({
  job,
  customer,
  compact = false,
  dragging = false,
  onOpen,
  onPressStart,
  onPressCancel,
  style,
}: JobBlockProps) {
  const { colorFor } = useTeam();
  const colors = job.assignedTo.map((uid) => colorFor(uid));
  const cancelled = job.status === "cancelled";
  const complete = job.status === "complete";

  return (
    <button
      type="button"
      onPointerDown={onPressStart}
      onPointerUp={onPressCancel}
      onPointerLeave={onPressCancel}
      onClick={() => onOpen(job)}
      style={{
        ...style,
        // touch-action none is what lets the drag hook own the gesture instead
        // of the browser turning it into a scroll.
        touchAction: onPressStart ? "none" : undefined,
        opacity: dragging ? 0.35 : cancelled ? 0.5 : 1,
      }}
      className={`relative flex w-full flex-col overflow-hidden rounded-lg border border-line bg-surface-2 text-left ${
        compact ? "gap-0 px-2 py-1" : "gap-0.5 px-2.5 py-1.5"
      } ${dragging ? "ring-2 ring-accent" : ""}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: assigneeStripe(colors) }}
      />
      <span className="pl-2">
        <span
          className={`block truncate font-bold text-ink ${
            compact ? "text-[11px]" : "text-sm"
          } ${cancelled ? "line-through" : ""}`}
        >
          {customer ? customerName(customer) : "Unknown customer"}
        </span>
        <span
          className={`block truncate font-semibold text-muted ${
            compact ? "text-[10px]" : "text-xs"
          }`}
        >
          {format(job.scheduledStart.toDate(), "h:mm a")} ·{" "}
          {SERVICE_SHORT_LABEL[job.serviceType]}
          {compact ? "" : ` · ${formatMoney(job.price)}`}
          {complete ? " · done" : ""}
        </span>
      </span>
    </button>
  );
}
