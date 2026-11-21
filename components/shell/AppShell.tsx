"use client";

import { usePathname } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";

import { isPublicRoute } from "@/lib/publicRoutes";
import { BottomNav } from "./BottomNav";
import { ConnectionBanner } from "./ConnectionBanner";
import { DemoBanner } from "./DemoBanner";
import { DesktopSidebar } from "./DesktopSidebar";
import { DesktopTopBar } from "./DesktopTopBar";
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
      {/* On a phone this is one column: banners, the screen, the tab bar. On
          a computer (`desktop:`, a mouse or trackpad) it becomes a row — the sidebar, then a column
          of top bar and screen — over the green backdrop. The wrapper around
          that column is `contents` otherwise, so on a phone it doesn't exist as
          far as layout goes and the phone's column is exactly what it was. */}
      <div className="desktop:gb-desktop-backdrop flex h-dvh flex-col desktop:flex-row print:block print:h-auto print:bg-none">
        <div className="hidden desktop:flex print:hidden">
          <DesktopSidebar />
        </div>
        <div className="contents desktop:flex desktop:min-w-0 desktop:flex-1 desktop:flex-col print:block">
          <div className="hidden desktop:contents print:hidden">
            <DesktopTopBar />
          </div>
          {/* Printing (the year-end packet) prints the page, not the app around it. */}
          {/* On a computer the banners sit in their own rounded strip under
              the top bar instead of running edge to edge; with none showing,
              the strip is empty and takes no space. */}
          <div className="contents desktop:mx-4 desktop:mt-4 desktop:flex desktop:flex-col desktop:overflow-hidden desktop:rounded-2xl desktop:empty:hidden print:hidden">
            <DemoBanner />
            <InstallPrompt />
            <ConnectionBanner />
          </div>
          <main className="min-h-0 flex-1 desktop:m-4 desktop:overflow-hidden desktop:rounded-3xl desktop:border desktop:border-white/10 desktop:shadow-[0_24px_60px_-30px_rgb(0_0_0/0.8)] print:m-0 print:overflow-visible print:rounded-none print:border-0">
            {children}
          </main>
        </div>
        <div className="contents print:hidden">
          <BottomNav onOpenMenu={openMenu} />
        </div>
        <NavDrawer open={menuOpen} onClose={closeMenu} />
        {/* "X mi since your last job — business?" Asks at most once per app open. */}
      </div>
    </MenuContext.Provider>
  );
}
