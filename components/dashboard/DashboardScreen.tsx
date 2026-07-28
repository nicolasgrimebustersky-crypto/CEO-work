"use client";

import { endOfWeek, format, isSameDay, startOfWeek } from "date-fns";
import Link from "next/link";
import { useMemo } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useJobs } from "@/components/providers/JobsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { UserChip } from "@/components/ui/Chips";
import { Spinner } from "@/components/ui/Spinner";
import { subscribeAllQuotes } from "@/lib/db/quotes";
import { customerName, formatMoney } from "@/lib/format";
import { SERVICE_LABEL } from "@/lib/status";
import type { Quote } from "@/lib/types";
import { useEffect, useState } from "react";

export function DashboardScreen() {
  const { jobs, loading } = useJobs();
  const { customers } = useCustomers();
  const { users, colorFor, nameFor } = useTeam();
  const [quotes, setQuotes] = useState<Quote[]>([]);

  useEffect(() => subscribeAllQuotes(setQuotes), []);

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 0 });

  const todayJobs = useMemo(
    () =>
      jobs
        .filter((job) => isSameDay(job.scheduledStart.toDate(), now))
        .filter((job) => job.status !== "cancelled")
        .sort((a, b) => a.scheduledStart.toMillis() - b.scheduledStart.toMillis()),
    // `now` is recreated each render but only its day matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs],
  );

  const todayRevenue = todayJobs.reduce((sum, job) => sum + job.price, 0);

  const completedThisWeek = useMemo(
    () =>
      jobs.filter((job) => {
        if (job.status !== "complete" || !job.completedAt) return false;
        const done = job.completedAt.toDate();
        return done >= weekStart && done <= weekEnd;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs],
  );

  const outstandingQuotes = quotes.filter(
    (quote) => quote.status === "sent" || quote.status === "no_response",
  );
  const outstandingValue = outstandingQuotes.reduce((sum, q) => sum + q.amount, 0);

  /** "Doors knocked" = pins logged this week, which is what the crew records. */
  const knocksThisWeek = useMemo(() => {
    const counts = new Map<string, number>();
    for (const customer of customers) {
      const created = customer.createdAt.toDate();
      if (created < weekStart || created > weekEnd) continue;
      counts.set(customer.createdBy, (counts.get(customer.createdBy) ?? 0) + 1);
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers]);

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader title="Today" />
        <Spinner label="Loading…" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Today" subtitle={format(now, "EEEE MMM d")} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Jobs today" value={String(todayJobs.length)} />
          <Stat label="Expected today" value={formatMoney(todayRevenue)} accent />
          <Stat label="Done this week" value={String(completedThisWeek.length)} />
          <Stat
            label="Open quotes"
            value={`${outstandingQuotes.length} · ${formatMoney(outstandingValue)}`}
          />
        </div>

        <section className="mt-6">
          <h2 className="mb-2 text-lg font-bold text-ink">Today, by person</h2>
          <div className="flex flex-col gap-2">
            {users.map((user) => {
              const mine = todayJobs.filter((job) => job.assignedTo.includes(user.uid));
              const revenue = mine.reduce((sum, job) => sum + job.price, 0);
              return (
                <div
                  key={user.uid}
                  className="rounded-xl border border-line bg-surface-2 p-3"
                  style={{ borderLeft: `4px solid ${colorFor(user.uid)}` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <UserChip name={user.displayName} color={colorFor(user.uid)} />
                    <span className="text-base font-black text-ink">
                      {mine.length} {mine.length === 1 ? "job" : "jobs"} ·{" "}
                      <span className="text-accent">{formatMoney(revenue)}</span>
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-muted">
                    {knocksThisWeek.get(user.uid) ?? 0} doors knocked this week
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">Today&apos;s schedule</h2>
            <Link
              href="/schedule"
              className="tap-target inline-flex items-center rounded-xl border border-line bg-surface-2 px-3 text-sm font-bold text-ink"
            >
              Open
            </Link>
          </div>

          {todayJobs.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
              Nothing scheduled today.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {todayJobs.map((job) => {
                const customer = customers.find((c) => c.id === job.customerId);
                return (
                  <li key={job.id}>
                    <Link
                      href={`/customers/${job.customerId}`}
                      className="flex items-start justify-between gap-2 rounded-xl border border-line bg-surface-2 p-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base font-bold text-ink">
                          {customer ? customerName(customer) : "Unknown customer"}
                        </span>
                        <span className="block text-sm font-semibold text-muted">
                          {format(job.scheduledStart.toDate(), "h:mm a")} ·{" "}
                          {SERVICE_LABEL[job.serviceType]}
                          {job.status === "complete" ? " · done" : ""}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {job.assignedTo.map((uid) => (
                            <UserChip key={uid} name={nameFor(uid)} color={colorFor(uid)} />
                          ))}
                        </span>
                      </span>
                      <span className="shrink-0 text-base font-black text-accent">
                        {formatMoney(job.price)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-6 pb-6">
          <Link
            href="/reports"
            className="tap-target flex items-center justify-center rounded-xl bg-accent px-4 py-3 text-base font-bold text-accent-ink"
          >
            See reports
          </Link>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-3">
      <p className="text-sm font-bold text-muted">{label}</p>
      <p className={`mt-0.5 text-2xl font-black ${accent ? "text-accent" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}
