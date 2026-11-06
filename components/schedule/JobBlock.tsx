"use client";

import { format } from "date-fns";

import { useTeam } from "@/components/providers/TeamProvider";
import { customerName, formatMoney } from "@/lib/format";
import { servicesLabel } from "@/lib/serviceText";
import type { Customer, Job } from "@/lib/types";
import { isBillable, VISIT_SHORT_LABEL, asVisitType } from "@/lib/visitTypes";

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

/**
 * How a block on the calendar is filled.
 *
 * Paid work is tinted with the colour of whoever is on it, fading to the card,
 * so the week reads as two people's days at a glance. Everything else — an
 * estimate visit, a walkthrough, a follow-up — is an appointment and is amber,
 * because a trip that earns nothing must never look like one that does.
 */
export function blockTone(
  job: Pick<Job, "visitType">,
  colors: string[],
): { className: string; style: React.CSSProperties } {
  if (!isBillable(job.visitType)) {
    return { className: "border border-appt/50 bg-appt/10", style: {} };
  }
  const tint = colors[0] ?? "#35424f";
  return {
    className: "border border-line bg-surface-2",
    style: {
      backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${tint} 22%, transparent), transparent 75%)`,
    },
  };
}

/** "ESTIMATE", "WALKTHROUGH" — the amber label an appointment block leads with. */
export function appointmentLabel(job: Pick<Job, "visitType">): string {
  return (VISIT_SHORT_LABEL[asVisitType(job.visitType)] || "Appointment").toUpperCase();
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

  const tone = blockTone(job, colors);
  const appointment = !isBillable(job.visitType);
  const services = servicesLabel(job);

  return (
    <button
      type="button"
      onPointerDown={onPressStart}
      onPointerUp={onPressCancel}
      onPointerLeave={onPressCancel}
      onClick={() => onOpen(job)}
      style={{
        ...style,
        ...tone.style,
        // touch-action none is what lets the drag hook own the gesture instead
        // of the browser turning it into a scroll.
        touchAction: onPressStart ? "none" : undefined,
        opacity: dragging ? 0.35 : cancelled ? 0.5 : 1,
      }}
      className={`relative flex w-full flex-col overflow-hidden rounded-xl text-left ${tone.className} ${
        compact ? "gap-0 px-2 py-1" : "gap-0.5 px-2.5 py-1.5"
      } ${dragging ? "ring-2 ring-accent" : ""}`}
    >
      {appointment ? null : (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1"
          style={{ background: assigneeStripe(colors) }}
        />
      )}
      <span className={appointment ? "" : "pl-1.5"}>
        {appointment ? (
          <span
            className={`block font-extrabold tracking-wide text-appt ${
              compact ? "text-[9px]" : "text-[11px]"
            }`}
          >
            {appointmentLabel(job)}
          </span>
        ) : null}
        <span
          className={`block truncate font-bold text-ink ${
            compact ? "text-[11px]" : "text-sm"
          } ${cancelled ? "line-through" : ""}`}
        >
          {customer ? customerName(customer) : "Unknown customer"}
        </span>
        {appointment ? null : (
          <span
            className={`block font-bold text-money tabular-nums ${
              compact ? "text-[10px]" : "text-xs"
            }`}
          >
            {formatMoney(job.price)}
          </span>
        )}
        <span
          className={`block truncate font-semibold text-muted ${
            compact ? "text-[10px]" : "text-xs"
          }`}
        >
          {format(job.scheduledStart.toDate(), "h:mm a")}
          {appointment ? "" : ` · ${services}`}
          {complete ? " · done" : ""}
        </span>
      </span>
    </button>
  );
}
