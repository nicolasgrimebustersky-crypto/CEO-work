"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { isPublicRoute } from "@/lib/publicRoutes";
import { BottomNav } from "./BottomNav";
import { ConnectionBanner } from "./ConnectionBanner";

/**
 * `min-h-0` on the main region is what lets the map fill the viewport instead
 * of overflowing it — without it a flex child refuses to shrink below its
 * content height and the nav bar gets pushed off screen.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // A public page gets no navigation: every tab behind it needs a session, so
  // showing them to a reader of the privacy policy is a dead end.
  if (isPublicRoute(pathname)) {
    return <div className="h-dvh overflow-y-auto">{children}</div>;
  }

  return (
    <div className="flex h-dvh flex-col">
      <ConnectionBanner />
      <main className="min-h-0 flex-1">{children}</main>
      <BottomNav />
    </div>
  );
}
