"use client";

import { STATUS_COLOR, STATUS_INK, STATUS_LABEL } from "@/lib/status";
import { readableInkOn } from "@/lib/userColor";
import type { CustomerStatus } from "@/lib/types";

export function StatusPill({ status }: { status: CustomerStatus }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-sm font-bold whitespace-nowrap"
      style={{
        backgroundColor: STATUS_COLOR[status],
        color: STATUS_INK[status],
        // "do not knock" is near-black; without a ring it disappears on dark UI.
        boxShadow: status === "do_not_knock" ? "inset 0 0 0 1.5px #6b7785" : undefined,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Attribution stamp — always the person's own colour, everywhere. */
export function UserChip({
  name,
  color,
  suffix,
}: {
  name: string;
  color: string;
  suffix?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-bold whitespace-nowrap"
      style={{ backgroundColor: color, color: readableInkOn(color) }}
    >
      {name}
      {suffix ? <span className="font-medium opacity-80">{suffix}</span> : null}
    </span>
  );
}

export function Chip({
  children,
  active = false,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const base =
    "tap-target inline-flex items-center rounded-full border px-3.5 py-2 text-sm font-semibold transition";
  if (!onClick) {
    return (
      <span className={`${base} border-line bg-surface-2 text-muted`}>{children}</span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} ${
        active
          ? "border-accent bg-accent text-accent-ink"
          : "border-line bg-surface-2 text-ink hover:bg-surface-3"
      }`}
    >
      {children}
    </button>
  );
}
