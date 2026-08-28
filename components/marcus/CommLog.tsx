"use client";

import { AGENT_PROFILE, type OpsFeedEntry } from "@/lib/ops/types";

import { LABEL, PANEL, ago } from "./theme";

/**
 * Everything the agents have reported, newest first.
 *
 * There is no invented content here: an empty feed renders as empty. A board
 * that fills itself with plausible-looking activity when the real system is
 * quiet would be worse than a blank one.
 */
export function CommLog({
  entries,
  now,
  failed,
}: {
  entries: OpsFeedEntry[];
  now: number;
  failed: boolean;
}) {
  return (
    <div className={PANEL}>
      <div className="mb-3 flex items-center justify-between">
        <span className={LABEL}>Comm log</span>
        <span className={LABEL}>{entries.length}</span>
      </div>

      {failed ? (
        <p className="text-xs text-[var(--noct-red)]">
          Could not read the comm log.
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-[var(--noct-dim)]">
          Nothing reported yet. Entries appear here as the agents publish them.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="text-xs">
              <div className="flex items-baseline gap-2">
                <span className="font-mono uppercase tracking-[0.14em] text-[var(--noct-accent-200)]">
                  {AGENT_PROFILE[entry.who].name}
                </span>
                <span className="font-mono text-[var(--noct-dim)]">
                  · {ago(entry.createdAt.toDate(), now)}
                </span>
              </div>
              <p className="mt-0.5 text-[var(--noct-muted)]">{entry.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
