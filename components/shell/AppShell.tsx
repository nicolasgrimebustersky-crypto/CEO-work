"use client";

import type { ReactNode } from "react";

import { BottomNav } from "./BottomNav";

/**
 * `min-h-0` on the main region is what lets the map fill the viewport instead
 * of overflowing it — without it a flex child refuses to shrink below its
 * content height and the nav bar gets pushed off screen.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <main className="min-h-0 flex-1">{children}</main>
      <BottomNav />
    </div>
  );
}
