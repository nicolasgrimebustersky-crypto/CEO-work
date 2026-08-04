"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "money" | "secondary" | "ghost" | "danger" | "contrast";

/**
 * Cyan is what you tap and green is what you earn, so `primary` and `money`
 * are two separate variants rather than one button with a colour prop — the
 * choice is about meaning, not decoration. `contrast` is the white pill: at
 * most one per screen, for the single thing you opened it to do.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink shadow-glow-accent hover:brightness-110 active:brightness-95",
  money: "bg-money text-money-ink shadow-glow-money hover:brightness-110 active:brightness-95",
  secondary:
    "bg-surface-2 text-ink border border-line hover:bg-surface-3 active:bg-surface-3",
  ghost: "bg-transparent text-ink hover:bg-surface-2 active:bg-surface-2",
  danger: "bg-danger text-white hover:brightness-110 active:brightness-95",
  contrast: "bg-ink text-canvas hover:brightness-95 active:brightness-90",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  full = false,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`tap-target inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${
        VARIANTS[variant]
      } ${full ? "w-full" : ""} ${className}`}
    >
      {children}
    </button>
  );
}
