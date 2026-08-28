"use client";

import { useState } from "react";

import { decideApproval } from "@/lib/db/ops";
import {
  AGENT_PROFILE,
  DECISION_IS_NOT_AN_ACTION,
  type ApprovalStatus,
  type OpsApproval,
} from "@/lib/ops/types";
import type { Author } from "@/lib/types";

import { LABEL, PANEL, ago } from "./theme";

const KIND_LABEL: Record<OpsApproval["kind"], string> = {
  money: "MONEY",
  legal: "LEGAL",
  content: "CONTENT",
  escalation: "ESCALATION",
};

const DECIDED_LABEL: Record<Exclude<ApprovalStatus, "pending">, string> = {
  approved: "Approved",
  alternate: "Alternate",
  rejected: "Rejected",
};

/**
 * The workshop: everything holding on a decision from Nicolas.
 *
 * Deciding writes a decision and stops. The agent that raised the item polls
 * for it and does the work — this screen has no send path, no spend path and
 * no posting path, which keeps hard rules 3 and 4 ("you draft, he sends")
 * true here as well as on Telegram. The line under the heading says so on
 * screen, because a button marked "Approve & send" next to a price will
 * otherwise be read as the thing that sends.
 */
export function ApprovalQueue({
  approvals,
  author,
  now,
  failed,
}: {
  approvals: OpsApproval[];
  author: Author | null;
  now: number;
  failed: boolean;
}) {
  const pending = approvals.filter((a) => a.status === "pending");
  const decided = approvals.filter((a) => a.status !== "pending");

  return (
    <div className="space-y-3">
      <div className={PANEL}>
        <div className="flex items-center justify-between">
          <span className={LABEL}>Waiting on you</span>
          <span className={LABEL}>{pending.length} pending</span>
        </div>
        <p className="mt-2 text-xs text-[var(--noct-dim)]">
          {DECISION_IS_NOT_AN_ACTION}
        </p>
      </div>

      {failed ? (
        <div className={PANEL}>
          <p className="text-xs text-[var(--noct-red)]">
            Could not read the approvals queue.
          </p>
        </div>
      ) : pending.length === 0 ? (
        <div className={PANEL}>
          <p className={LABEL}>Queue clear — the agents keep working</p>
        </div>
      ) : (
        pending.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            author={author}
            now={now}
          />
        ))
      )}

      {decided.length > 0 ? (
        <div className={PANEL}>
          <span className={LABEL}>Decided</span>
          <ul className="mt-2 space-y-2">
            {decided.map((approval) => (
              <li key={approval.id} className="flex gap-3 text-xs">
                <span className="w-16 shrink-0 font-mono uppercase tracking-[0.14em] text-[var(--noct-dim)]">
                  {DECIDED_LABEL[approval.status as Exclude<ApprovalStatus, "pending">]}
                </span>
                <span className="min-w-0 text-[var(--noct-muted)]">
                  {approval.title}
                  {approval.decidedByName ? (
                    <span className="text-[var(--noct-dim)]">
                      {" "}
                      — {approval.decidedByName}
                      {approval.decidedAt
                        ? `, ${ago(approval.decidedAt.toDate(), now)} ago`
                        : ""}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ApprovalCard({
  approval,
  author,
  now,
}: {
  approval: OpsApproval;
  author: Author | null;
  now: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEscalation = approval.positionA !== null && approval.positionB !== null;

  async function decide(status: Exclude<ApprovalStatus, "pending">) {
    if (!author || busy) return;
    setBusy(true);
    setError(null);
    try {
      await decideApproval(approval.id, status, author);
    } catch {
      // The row stays pending on screen, which is the honest outcome: a
      // decision that did not save is a decision that did not happen.
      setError("That did not save. The item is still waiting.");
      setBusy(false);
    }
  }

  return (
    <article className={PANEL}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
            approval.kind === "money" || approval.kind === "legal"
              ? "text-[var(--noct-amber)]"
              : "text-[var(--noct-accent-200)]"
          }`}
        >
          {KIND_LABEL[approval.kind]}
        </span>
        <span className={LABEL}>
          from {AGENT_PROFILE[approval.who].name} ·{" "}
          {ago(approval.createdAt.toDate(), now)}
        </span>
        {approval.cost ? (
          <span className="ml-auto font-mono text-xs text-[var(--noct-amber)]">
            {approval.cost}
          </span>
        ) : null}
      </div>

      <h3 className="mt-2 text-sm font-semibold text-[var(--noct-text)]">
        {approval.title}
      </h3>
      {approval.detail ? (
        <p className="mt-1 text-xs text-[var(--noct-muted)]">{approval.detail}</p>
      ) : null}

      {isEscalation ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[approval.positionA, approval.positionB].map((position, index) =>
            position ? (
              <div
                key={index}
                className="rounded-lg border border-[var(--noct-line)] p-3"
              >
                <span className={LABEL}>{position.who}</span>
                <p className="mt-1 text-xs text-[var(--noct-muted)]">
                  {position.position}
                </p>
              </div>
            ) : null,
          )}
        </div>
      ) : null}

      {isEscalation ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--noct-dim)]">
          Both positions as argued — no averaging. Your call.
        </p>
      ) : null}

      {approval.marcusRead ? (
        <div className="mt-3 rounded-lg border border-[var(--noct-line)] bg-[var(--noct-surface-2)] p-3">
          <span className={LABEL}>Marcus&rsquo; read</span>
          <p className="mt-1 text-xs text-[var(--noct-muted)]">
            {approval.marcusRead}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !author}
          onClick={() => void decide("approved")}
          className="rounded-lg bg-[var(--noct-accent)] px-3 py-2 text-xs font-semibold text-[#161826] disabled:opacity-50"
        >
          {approval.approveLabel}
        </button>
        {approval.altLabel ? (
          <button
            type="button"
            disabled={busy || !author}
            onClick={() => void decide("alternate")}
            className="rounded-lg border border-[var(--noct-accent-600)] px-3 py-2 text-xs font-semibold text-[var(--noct-accent-200)] disabled:opacity-50"
          >
            {approval.altLabel}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || !author}
          onClick={() => void decide("rejected")}
          className="rounded-lg border border-[var(--noct-line)] px-3 py-2 text-xs font-semibold text-[var(--noct-muted)] disabled:opacity-50"
        >
          Reject
        </button>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-[var(--noct-red)]">{error}</p>
      ) : null}
    </article>
  );
}
