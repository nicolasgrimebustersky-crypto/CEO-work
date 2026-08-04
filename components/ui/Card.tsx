"use client";

import type { ReactNode } from "react";

/**
 * The one card in the app.
 *
 * On a near-black canvas the depth comes from the hairline border, not from
 * the fill — the surface is only a few percent lighter than the page behind
 * it. That is what lets a screen carry six stacked cards without turning into
 * a stack of grey slabs.
 */
export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border border-line bg-surface ${
        padded ? "p-4" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** Section title above a card, matching the reference's quiet all-caps labels. */
export function CardLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 px-1 text-xs font-bold tracking-wider text-muted uppercase">
      {children}
    </p>
  );
}

const TONES = {
  accent: "bg-accent/15 text-accent",
  money: "bg-money/15 text-money",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  neutral: "bg-surface-3 text-muted",
} as const;

/**
 * The rounded-square icon holder from the reference: a tinted wash behind a
 * full-strength icon. Tinting the background rather than colouring a bare icon
 * gives the row a fixed left edge, so a list of them lines up even when the
 * glyphs inside are different widths.
 */
export function IconTile({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
