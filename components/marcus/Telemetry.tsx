"use client";

import { useEffect, useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useJobs } from "@/components/providers/JobsProvider";
import { subscribeAllQuotes } from "@/lib/db/quotes";
import { formatMoney } from "@/lib/format";
import type { Quote } from "@/lib/types";

import { LABEL, PANEL } from "./theme";

/**
 * Business telemetry, read from the CRM itself.
 *
 * Nothing on this panel comes from the agents. Every number is computed from
 * jobs, quotes and customers — the same documents the rest of the app renders
 * — so a figure here cannot disagree with the screen it came from, and an
 * agent cannot report a revenue number that the book does not support.
 */
export function Telemetry() {
  const { jobs } = useJobs();
  const { customers } = useCustomers();
  const [quotes, setQuotes] = useState<Quote[]>([]);

  useEffect(() => subscribeAllQuotes(setQuotes), []);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);

  const completed = useMemo(
    () => jobs.filter((job) => job.status === "complete" && job.completedAt),
    [jobs],
  );

  const revenueMtd = completed
    .filter((job) => job.completedAt!.toDate() >= monthStart)
    .reduce((sum, job) => sum + job.price, 0);

  const accepted = quotes.filter((quote) => quote.status === "accepted").length;
  const closeRate = quotes.length > 0 ? Math.round((accepted / quotes.length) * 100) : null;

  const leadsThisWeek = customers.filter(
    (customer) => customer.createdAt.toDate() >= weekStart,
  ).length;

  const outstanding = quotes.filter(
    (quote) => quote.status === "sent" || quote.status === "no_response",
  );
  const outstandingValue = outstanding.reduce((sum, quote) => sum + quote.amount, 0);

  /** The last eight months of completed work, oldest first. */
  const months = useMemo(() => {
    const buckets: { label: string; total: number }[] = [];
    for (let back = 7; back >= 0; back -= 1) {
      const start = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
      const total = completed
        .filter((job) => {
          const done = job.completedAt!.toDate();
          return done >= start && done < end;
        })
        .reduce((sum, job) => sum + job.price, 0);
      buckets.push({
        label: start.toLocaleString("en-US", { month: "short" }).toUpperCase(),
        total,
      });
    }
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);

  const peak = Math.max(1, ...months.map((month) => month.total));

  const stats: { label: string; value: string; note: string }[] = [
    {
      label: "Revenue MTD",
      value: formatMoney(revenueMtd),
      note: `${completed.filter((job) => job.completedAt!.toDate() >= monthStart).length} jobs completed`,
    },
    {
      label: "Quote → close",
      value: closeRate === null ? "—" : `${closeRate}%`,
      note: closeRate === null ? "no quotes yet" : `${accepted} of ${quotes.length} quotes`,
    },
    {
      label: "Leads this week",
      value: String(leadsThisWeek),
      note: "new customer records",
    },
    {
      label: "Quotes outstanding",
      value: String(outstanding.length),
      note: `${formatMoney(outstandingValue)} unanswered`,
    },
  ];

  return (
    <div className="space-y-3">
      <div className={PANEL}>
        <span className={LABEL}>Business telemetry</span>
        <p className="mt-2 text-xs text-[var(--noct-dim)]">
          Computed from the CRM — jobs, quotes and customers. Not from the agents.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-[var(--noct-line)] p-3"
            >
              <span className={LABEL}>{stat.label}</span>
              <p className="mt-1 text-xl font-semibold text-[var(--noct-text)]">
                {stat.value}
              </p>
              <p className="text-[11px] text-[var(--noct-dim)]">{stat.note}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={PANEL}>
        <span className={LABEL}>Revenue by month — completed work</span>
        <div className="mt-4 flex h-32 items-end gap-2">
          {months.map((month, index) => (
            <div key={month.label} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[10px] text-[var(--noct-muted)]">
                {month.total > 0 ? formatMoney(month.total) : ""}
              </span>
              <div
                className="w-full max-w-9 rounded-t bg-gradient-to-b from-[var(--noct-accent-400)] to-transparent"
                style={{
                  height: `${Math.max(2, Math.round((month.total / peak) * 96))}px`,
                  opacity: index === months.length - 1 ? 1 : 0.55,
                }}
              />
              <span className={LABEL}>{month.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
