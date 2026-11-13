"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CustomerPickerSheet } from "@/components/documents/CustomerPickerSheet";
import { routes } from "@/lib/routes";
import { NotificationBell } from "./NotificationBell";
import { PlusIcon, SearchIcon } from "./navIcons";

/**
 * The strip across the top of the computer layout: search, the one button
 * that starts work, and the bell.
 *
 * Search is a button that looks like a box rather than a real field, because
 * the Search screen already is the field — with its filters and results — and
 * a second, lesser search up here would only disagree with it. Ctrl+K (⌘K on
 * a Mac) gets there from anywhere without the mouse.
 */
export function DesktopTopBar() {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        router.push(routes.search);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <>
      <div className="glass mx-4 mt-4 flex shrink-0 items-center gap-3 rounded-3xl border px-3 py-2.5">
        <button
          type="button"
          onClick={() => router.push(routes.search)}
          className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-2xl bg-white/5 px-4 text-left text-sm font-semibold text-muted transition hover:bg-white/10"
        >
          <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-5">
            <SearchIcon />
          </span>
          <span className="min-w-0 flex-1 truncate">
            Search clients, jobs, estimates, notes…
          </span>
          <kbd className="shrink-0 rounded-md border border-white/15 px-1.5 py-0.5 font-sans text-[11px] font-bold text-muted">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>

        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-ink px-4 text-sm font-bold text-canvas transition hover:brightness-95"
        >
          <span className="flex size-5 items-center justify-center [&_svg]:size-5">
            <PlusIcon />
          </span>
          New estimate
        </button>

        <NotificationBell />
      </div>

      <CustomerPickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(customerId) => {
          setPicking(false);
          router.push(routes.newDocument("estimate", customerId));
        }}
      />
    </>
  );
}
