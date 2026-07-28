"use client";

import { useConnection } from "@/components/providers/ConnectionProvider";

/**
 * One line, only when something is wrong. Knocking doors on rural roads means
 * losing signal constantly, and the thing that erodes trust in an app like this
 * is not knowing whether the note you just typed actually saved.
 */
export function ConnectionBanner() {
  const { online, pendingWrites } = useConnection();

  if (online && !pendingWrites) return null;

  const offline = !online;

  return (
    <div
      role="status"
      className={`shrink-0 px-3 py-1.5 text-center text-sm font-bold ${
        offline ? "bg-warn text-black" : "bg-surface-3 text-ink"
      }`}
    >
      {offline
        ? "Offline — your changes are saved here and will sync when signal returns."
        : "Syncing changes…"}
    </div>
  );
}
