"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/providers/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import {
  subscribeAgents,
  subscribeApprovals,
  subscribeFeed,
} from "@/lib/db/ops";
import {
  AGENT_IDS,
  type AgentId,
  type OpsAgent,
  type OpsApproval,
  type OpsFeedEntry,
} from "@/lib/ops/types";

import { AgentDetail, AgentRoster, statusKeyFor } from "./AgentRoster";
import { ApprovalQueue } from "./ApprovalQueue";
import { CommLog } from "./CommLog";
import { Routing } from "./Routing";
import { Telemetry } from "./Telemetry";
import { LABEL, NOCTURNE_VARS, clockTime } from "./theme";

type View = "core" | "workshop" | "routing" | "telemetry";

const VIEWS: { key: View; label: string }[] = [
  { key: "core", label: "CORE" },
  { key: "workshop", label: "WORKSHOP" },
  { key: "routing", label: "ROUTING" },
  { key: "telemetry", label: "TELEMETRY" },
];

/**
 * M.A.R.C.U.S — the command centre for the agent system in grimebusters-ops.
 *
 * Three of the four panels read collections the agents publish to; telemetry
 * reads the CRM itself. The screen writes exactly one thing — a decision on an
 * approval — and that decision is a record, not an action: the agent carries
 * it out and reports back. See lib/ops/types.ts.
 */
export function MarcusScreen() {
  const { author } = useAuth();
  const [view, setView] = useState<View>("core");
  const [selected, setSelected] = useState<AgentId>("marcus");

  const [agents, setAgents] = useState<OpsAgent[]>([]);
  const [feed, setFeed] = useState<OpsFeedEntry[]>([]);
  const [approvals, setApprovals] = useState<OpsApproval[]>([]);
  const [feedFailed, setFeedFailed] = useState(false);
  const [approvalsFailed, setApprovalsFailed] = useState(false);

  /**
   * One clock for the whole board, ticking every 30s. Every "9m ago" on screen
   * is derived from this, so they all age together rather than each panel
   * freezing at whatever second it last rendered.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => subscribeAgents(setAgents), []);
  useEffect(() => subscribeFeed(setFeed, () => setFeedFailed(true)), []);
  useEffect(
    () => subscribeApprovals(setApprovals, () => setApprovalsFailed(true)),
    [],
  );

  const pending = approvals.filter((approval) => approval.status === "pending");
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const reporting = AGENT_IDS.filter(
    (id) => statusKeyFor(byId.get(id), now) !== "stale",
  ).length;

  return (
    <div
      style={NOCTURNE_VARS as React.CSSProperties}
      className="flex min-h-full flex-col bg-[var(--noct-bg)] text-[var(--noct-text)]"
    >
      <ScreenHeader
        title="M.A.R.C.U.S"
        subtitle="Managing Agent · Routing · Command · Unified System"
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--noct-line)] px-4 py-2">
        <span className={LABEL}>
          {reporting > 0 ? `${reporting} reporting` : "no agents reporting"}
        </span>
        <span className={LABEL}>
          {pending.length} waiting on you
        </span>
        <span className={`ml-auto ${LABEL}`}>{clockTime(new Date(now))}</span>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--noct-line)] px-3 py-2">
        {VIEWS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setView(entry.key)}
            aria-current={view === entry.key ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
              view === entry.key
                ? "bg-[var(--noct-surface-2)] text-[var(--noct-accent-200)]"
                : "text-[var(--noct-dim)] hover:text-[var(--noct-muted)]"
            }`}
          >
            {entry.label}
            {entry.key === "workshop" && pending.length > 0 ? (
              <span className="ml-1.5 text-[var(--noct-amber)]">
                {pending.length}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 pb-safe">
        {view === "core" ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              <AgentRoster
                agents={agents}
                selected={selected}
                onSelect={setSelected}
                now={now}
              />
              <AgentDetail
                agentId={selected}
                agent={byId.get(selected)}
                now={now}
              />
            </div>
            <CommLog entries={feed} now={now} failed={feedFailed} />
          </div>
        ) : null}

        {view === "workshop" ? (
          <ApprovalQueue
            approvals={approvals}
            author={author}
            now={now}
            failed={approvalsFailed}
          />
        ) : null}

        {view === "routing" ? (
          <Routing agents={agents} pendingCount={pending.length} now={now} />
        ) : null}

        {view === "telemetry" ? <Telemetry /> : null}
      </div>
    </div>
  );
}
