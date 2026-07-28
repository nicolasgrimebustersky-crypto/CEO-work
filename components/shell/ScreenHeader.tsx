"use client";

import type { ReactNode } from "react";

import { NotificationBell } from "./NotificationBell";

/**
 * Shared top bar for the non-map screens. The bell lives here rather than in
 * the bottom nav so the nav stays purely navigational and every tap target down
 * there keeps its full width.
 */
export function ScreenHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="pt-safe shrink-0 border-b border-line bg-surface px-4 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight text-ink">{title}</h1>
          {subtitle ? (
            <p className="mt-0.5 text-base font-semibold text-muted">{subtitle}</p>
          ) : null}
        </div>
        <NotificationBell />
      </div>
      {children}
    </header>
  );
}
