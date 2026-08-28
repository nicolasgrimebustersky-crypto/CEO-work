/**
 * Nocturne — the command centre's own palette, lifted from the design.
 *
 * This screen deliberately does not use the app's light surfaces. It is a
 * status board you glance at, not a form you fill in, and the design it came
 * from is dark with one blurple accent. The tokens are scoped to the screen's
 * root element so nothing here leaks into the rest of the CRM.
 */
export const NOCTURNE_VARS = {
  "--noct-bg": "#161826",
  "--noct-surface": "#232532",
  "--noct-surface-2": "#292b31",
  "--noct-text": "#e9e9ed",
  "--noct-muted": "#9397ab",
  "--noct-dim": "#75798c",
  "--noct-line": "color-mix(in srgb, #e9e9ed 16%, transparent)",
  "--noct-accent": "#9184d9",
  "--noct-accent-200": "#e7e5fe",
  "--noct-accent-400": "#b5abfc",
  "--noct-accent-600": "#796cbf",
  /** Amber is "needs you" and nothing else, so it always means one thing. */
  "--noct-amber": "#e0b15c",
  "--noct-red": "#d97b7b",
} as const satisfies Record<string, string>;

/** The board's labels are mono caps — it reads as instrumentation, not prose. */
export const LABEL =
  "font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--noct-dim)]";

export const PANEL =
  "rounded-xl border border-[var(--noct-line)] bg-[var(--noct-surface)] p-4";

export const STATUS_STYLE = {
  working: {
    label: "WORKING",
    dot: "bg-[var(--noct-accent-400)] animate-pulse",
    text: "text-[var(--noct-accent-200)]",
    ring: "border-[var(--noct-accent-600)]",
  },
  waiting: {
    label: "NEEDS YOU",
    dot: "bg-[var(--noct-amber)]",
    text: "text-[var(--noct-amber)]",
    ring: "border-[color-mix(in_srgb,var(--noct-amber)_60%,transparent)]",
  },
  idle: {
    label: "IDLE",
    dot: "bg-[var(--noct-dim)]",
    text: "text-[var(--noct-muted)]",
    ring: "border-[var(--noct-dim)]",
  },
  /**
   * Not a status an agent can publish — the screen derives it when a heartbeat
   * goes cold. See lib/ops/types.ts#isStale.
   */
  stale: {
    label: "NOT REPORTING",
    dot: "bg-[var(--noct-dim)] opacity-50",
    text: "text-[var(--noct-dim)]",
    ring: "border-[var(--noct-line)]",
  },
} as const;

export type StatusKey = keyof typeof STATUS_STYLE;

/** "9:41" in the owner's own timezone, which is the only one that matters. */
export function clockTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "now", "9m", "3h", "2d" — the feed's own scale. */
export function ago(from: Date, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - from.getTime()) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
