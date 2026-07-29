"use client";

import { useState } from "react";

import { isDemoMode } from "@/lib/demo/enabled";

/**
 * Always on screen while the demo build is running.
 *
 * Everything below it is invented — the customers, the addresses, the money.
 * Someone who lands on this link and assumes they are looking at a real book of
 * business would be badly misled, so the notice is not dismissible. The
 * "what's fake" details collapse; the first line does not.
 */
export function DemoBanner() {
  const [open, setOpen] = useState(false);

  if (!isDemoMode) return null;

  return (
    <div className="shrink-0 border-b border-accent/40 bg-accent/15">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-center gap-2 px-3 py-1.5 text-center text-sm font-bold text-ink"
      >
        <span className="truncate">Demo data — nothing is saved</span>
        <span aria-hidden className="text-xs opacity-70">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div className="px-4 pb-3 text-sm font-semibold leading-relaxed text-muted">
          <p>
            The customers, jobs and figures here are made up. Edits work and show up
            everywhere they should, but they live in this browser tab only — a reload
            starts over, and nothing reaches a database.
          </p>
          <p className="mt-2">
            Texts are simulated: the buttons complete as if a message went out, but no
            phone is contacted. Sign-in accepts any email and password.
          </p>
        </div>
      ) : null}
    </div>
  );
}
