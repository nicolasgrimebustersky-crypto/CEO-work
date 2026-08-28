"use client";

import { useEffect, useState } from "react";

import { subscribeAgentLog } from "@/lib/db/ops";
import {
  AGENT_IDS,
  AGENT_PROFILE,
  isStale,
  type AgentId,
  type OpsAgent,
  type OpsFeedEntry,
} from "@/lib/ops/types";

import { LABEL, PANEL, STATUS_STYLE, ago, type StatusKey } from "./theme";

/**
 * The roster is built from AGENT_IDS, not from what Firestore returned.
 *
 * An agent that has never published is still on the board, marked as not
 * reporting. The alternative — showing only the rows that exist — quietly
 * hides an agent whose publishing broke, which is the failure most worth
 * seeing.
 */
export function statusKeyFor(agent: OpsAgent | undefined, now: number): StatusKey {
  if (!agent) return "stale";
  return isStale(agent, now) ? "stale" : agent.status;
}

export function AgentRoster({
  agents,
  selected,
  onSelect,
  now,
}: {
  agents: OpsAgent[];
  selected: AgentId;
  onSelect: (id: AgentId) => void;
  now: number;
}) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const reporting = AGENT_IDS.filter(
    (id) => statusKeyFor(byId.get(id), now) !== "stale",
  ).length;

  return (
    <div className={PANEL}>
      <div className="mb-3 flex items-center justify-between">
        <span className={LABEL}>Agents</span>
        <span className={LABEL}>
          {reporting} of {AGENT_IDS.length} reporting
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {AGENT_IDS.map((id) => {
          const agent = byId.get(id);
          const key = statusKeyFor(agent, now);
          const style = STATUS_STYLE[key];
          const profile = AGENT_PROFILE[id];
          const isSelected = id === selected;

          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-pressed={isSelected}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                isSelected
                  ? "border-[var(--noct-accent-600)] bg-[var(--noct-surface-2)]"
                  : "border-[var(--noct-line)] hover:bg-[var(--noct-surface-2)]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${style.dot}`}
                />
                <span className="truncate text-sm font-semibold text-[var(--noct-text)]">
                  {profile.name}
                </span>
                <span className={`ml-auto shrink-0 ${LABEL} ${style.text}`}>
                  {style.label}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-[var(--noct-muted)]">
                {key === "stale"
                  ? `${profile.role} — no check-in`
                  : (agent?.task ?? profile.role)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The selected agent's own work log, straight from the comm feed. */
export function AgentDetail({
  agentId,
  agent,
  now,
}: {
  agentId: AgentId;
  agent: OpsAgent | undefined;
  now: number;
}) {
  const [log, setLog] = useState<OpsFeedEntry[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    return subscribeAgentLog(agentId, setLog, () => setFailed(true));
  }, [agentId]);

  const profile = AGENT_PROFILE[agentId];
  const key = statusKeyFor(agent, now);
  const style = STATUS_STYLE[key];

  return (
    <div className={PANEL}>
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${style.ring} font-mono text-sm text-[var(--noct-text)]`}
        >
          {profile.name.charAt(0)}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--noct-text)]">
            {profile.name}
          </h2>
          <p className="text-xs text-[var(--noct-muted)]">{profile.role}</p>
        </div>
        <span className={`ml-auto shrink-0 ${LABEL} ${style.text}`}>
          {style.label}
        </span>
      </div>

      <p className="mt-3 text-sm text-[var(--noct-text)]">
        {key === "stale"
          ? "Has not checked in. Anything below is the last thing it reported."
          : (agent?.task ?? "—")}
      </p>

      <div className="mt-4">
        <span className={LABEL}>Work log</span>
        {failed ? (
          <p className="mt-2 text-xs text-[var(--noct-red)]">
            Could not read the log.
          </p>
        ) : log.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--noct-dim)]">
            Nothing logged yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {log.map((entry) => (
              <li key={entry.id} className="flex gap-3 text-xs">
                <span className="shrink-0 font-mono text-[var(--noct-dim)]">
                  {ago(entry.createdAt.toDate(), now)}
                </span>
                <span className="text-[var(--noct-muted)]">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
