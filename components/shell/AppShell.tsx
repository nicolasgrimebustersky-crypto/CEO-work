"use client";

import { usePathname } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";

import { isPublicRoute } from "@/lib/publicRoutes";
import { BottomNav } from "./BottomNav";
import { ConnectionBanner } from "./ConnectionBanner";
import { DemoBanner } from "./DemoBanner";
import { InstallPrompt } from "./InstallPrompt";
import { MenuContext } from "./menu";
import { NavDrawer } from "./NavDrawer";

/**
 * `min-h-0` on the main region is what lets the map fill the viewport instead
 * of overflowing it — without it a flex child refuses to shrink below its
 * content height and the nav bar gets pushed off screen.
 *
 * The drawer's open state lives here rather than in the drawer because two
 * things open it: the "More" tab at the bottom and the hamburger in each
 * screen header.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const openMenu = useCallback(() => setMenuOpen(true), []);

  // A public page gets no navigation: every tab behind it needs a session, so
  // showing them to a reader of the privacy policy is a dead end.
  if (isPublicRoute(pathname)) {
    return <div className="h-dvh overflow-y-auto">{children}</div>;
  }

  return (
    <MenuContext.Provider value={openMenu}>
      <div className="flex h-dvh flex-col">
        <DemoBanner />
        <InstallPrompt />
        <ConnectionBanner />
        <main className="min-h-0 flex-1">{children}</main>
        <BottomNav onOpenMenu={openMenu} />
        <NavDrawer open={menuOpen} onClose={closeMenu} />
      </div>
    </MenuContext.Provider>
  );
}
