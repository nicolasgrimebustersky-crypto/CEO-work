"use client";

import { AGENT_IDS, AGENT_PROFILE, type OpsAgent } from "@/lib/ops/types";

import { LABEL, PANEL, STATUS_STYLE } from "./theme";
import { statusKeyFor } from "./AgentRoster";

/**
 * How work reaches Nicolas: it doesn't, unless Marcus holds it.
 *
 * This panel is the operating rule drawn out — five specialists report to
 * Marcus, Marcus routes, and only money, legal and a genuine disagreement
 * reach the owner. It is drawn from the live roster so the counts are real,
 * not an illustration.
 */
export function Routing({
  agents,
  pendingCount,
  now,
}: {
  agents: OpsAgent[];
  pendingCount: number;
  now: number;
}) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const specialists = AGENT_IDS.filter((id) => id !== "marcus");

  return (
    <div className="space-y-3">
      <div className={PANEL}>
        <span className={LABEL}>Routing</span>
        <p className="mt-2 text-xs text-[var(--noct-dim)]">
          Everything routes through Marcus — only money, legal and a real
          disagreement reach you.
        </p>
      </div>

      <div className={PANEL}>
        <div className="rounded-lg border border-[var(--noct-accent-600)] bg-[var(--noct-surface-2)] p-3 text-center">
          <span className={LABEL}>You</span>
          <p className="mt-1 text-sm text-[var(--noct-text)]">
            decisions · direction
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--noct-amber)]">
            {pendingCount} held for you
          </p>
        </div>

        <div aria-hidden className="mx-auto h-5 w-px bg-[var(--noct-line)]" />

        <div className="rounded-lg border border-[var(--noct-line)] p-3 text-center">
          <span className={LABEL}>Marcus</span>
          <p className="mt-1 text-sm text-[var(--noct-text)]">routes everything</p>
        </div>

        <div aria-hidden className="mx-auto h-5 w-px bg-[var(--noct-line)]" />

        <div className="grid gap-2 sm:grid-cols-5">
          {specialists.map((id) => {
            const key = statusKeyFor(byId.get(id), now);
            const style = STATUS_STYLE[key];
            const profile = AGENT_PROFILE[id];
            return (
              <div
                key={id}
                className="rounded-lg border border-[var(--noct-line)] p-3 text-center"
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span
                    aria-hidden
                    className={`size-1.5 rounded-full ${style.dot}`}
                  />
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--noct-text)]">
                    {profile.name}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--noct-dim)]">
                  {profile.short}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
