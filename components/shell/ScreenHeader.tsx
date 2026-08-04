"use client";

import type { ReactNode } from "react";

import { useOpenMenu } from "./menu";
import { MenuIcon } from "./navIcons";
import { NotificationBell } from "./NotificationBell";

/**
 * Shared top bar for the non-map screens. The hamburger and the bell live here
 * rather than in the bottom nav so the nav stays purely navigational and every
 * tap target down there keeps its full width.
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
  const openMenu = useOpenMenu();

  return (
    <header className="pt-safe shrink-0 border-b border-line bg-surface px-4 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {openMenu ? (
            <button
              type="button"
              onClick={openMenu}
              aria-label="Open menu"
              className="tap-target -ml-2 flex shrink-0 items-center justify-center rounded-2xl px-2 text-muted hover:bg-surface-2 hover:text-ink"
            >
              <MenuIcon />
            </button>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
            {subtitle ? (
              <p className="mt-0.5 text-base font-semibold text-muted">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <NotificationBell />
      </div>
      {children}
    </header>
  );
}
