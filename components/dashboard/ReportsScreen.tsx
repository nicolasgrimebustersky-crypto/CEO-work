"use client";

import { format, startOfMonth, subMonths } from "date-fns";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { UserChip } from "@/components/ui/Chips";
import { Spinner } from "@/components/ui/Spinner";
import { fetchJobsBetween } from "@/lib/db/jobs";
import { quoteCloseRate, subscribeAllQuotes } from "@/lib/db/quotes";
import { formatMoney } from "@/lib/format";
import { zipFromAddress } from "@/lib/geocode";
import { SERVICE_LABEL } from "@/lib/status";
import { SERVICE_TYPES, type Job, type Quote, type ServiceType } from "@/lib/types";

const MONTHS_BACK = 12;

export function ReportsScreen() {
  const { customers } = useCustomers();
  const { users, colorFor } = useTeam();

  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reports read a wider window than the calendar keeps loaded, so this is a
  // one-shot fetch rather than another realtime listener.
  useEffect(() => {
    const from = startOfMonth(subMonths(new Date(), MONTHS_BACK - 1));
    fetchJobsBetween(from, new Date())
      .then(setJobs)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => subscribeAllQuotes(setQuotes), []);

  const completed = useMemo(
    () => (jobs ?? []).filter((job) => job.status === "complete"),
    [jobs],
  );

  const byMonth = useMemo(() => {
    const buckets = new Map<string, number>();
    for (let i = MONTHS_BACK - 1; i >= 0; i -= 1) {
      buckets.set(format(subMonths(new Date(), i), "MMM yy"), 0);
    }
    for (const job of completed) {
      const key = format(job.completedAt?.toDate() ?? job.scheduledStart.toDate(), "MMM yy");
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + job.price);
    }
    return [...buckets.entries()];
  }, [completed]);

  const byService = useMemo(() => {
    const totals = new Map<ServiceType, number>(
      SERVICE_TYPES.map((service) => [service, 0]),
    );
    for (const job of completed) {
      totals.set(job.serviceType, (totals.get(job.serviceType) ?? 0) + job.price);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [completed]);

  /** Neighbourhoods are approximated by ZIP, parsed out of the pin's address. */
  const byNeighbourhood = useMemo(() => {
    const revenueByCustomer = new Map<string, number>();
    for (const job of completed) {
      revenueByCustomer.set(
        job.customerId,
        (revenueByCustomer.get(job.customerId) ?? 0) + job.price,
      );
    }

    const zips = new Map<string, { revenue: number; customers: number }>();
    for (const customer of customers) {
      const zip = zipFromAddress(customer.address) ?? "Unknown";
      const entry = zips.get(zip) ?? { revenue: 0, customers: 0 };
      entry.revenue += revenueByCustomer.get(customer.id) ?? 0;
      entry.customers += 1;
      zips.set(zip, entry);
    }

    return [...zips.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 6);
  }, [completed, customers]);

  const perUser = useMemo(
    () =>
      users.map((user) => {
        const theirJobs = completed.filter((job) => job.assignedTo.includes(user.uid));
        return {
          uid: user.uid,
          name: user.displayName,
          jobs: theirJobs.length,
          revenue: theirJobs.reduce((sum, job) => sum + job.price, 0),
          pins: customers.filter((customer) => customer.createdBy === user.uid).length,
          quotes: quotes.filter((quote) => quote.sentBy === user.uid).length,
        };
      }),
    [users, completed, customers, quotes],
  );

  const close = quoteCloseRate(quotes);
  const totalRevenue = completed.reduce((sum, job) => sum + job.price, 0);
  const maxMonth = Math.max(1, ...byMonth.map(([, value]) => value));
  const maxService = Math.max(1, ...byService.map(([, value]) => value));

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Reports" subtitle={`Last ${MONTHS_BACK} months`} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-danger/60 bg-danger/15 px-3 py-3 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}

        {jobs === null ? (
          <Spinner label="Crunching numbers…" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Revenue" value={formatMoney(totalRevenue)} accent />
              <Stat label="Jobs completed" value={String(completed.length)} />
              <Stat
                label="Quote close rate"
                value={
                  close.decided === 0 ? "—" : `${Math.round(close.rate * 100)}%`
                }
              />
              <Stat
                label="Quotes answered"
                value={`${close.decided} of ${quotes.length}`}
              />
            </div>

            <Section title="Revenue by month">
              <ul className="flex flex-col gap-1.5">
                {byMonth.map(([label, value]) => (
                  <li key={label} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-sm font-bold whitespace-nowrap text-muted">
                      {label}
                    </span>
                    <span className="h-6 flex-1 overflow-hidden rounded bg-surface-2">
                      <span
                        className="block h-full rounded bg-accent"
                        style={{ width: `${Math.max((value / maxMonth) * 100, value > 0 ? 4 : 0)}%` }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right text-sm font-bold text-ink">
                      {value > 0 ? formatMoney(value) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Revenue by service">
              <ul className="flex flex-col gap-1.5">
                {byService.map(([service, value]) => (
                  <li key={service} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-sm font-bold text-muted">
                      {SERVICE_LABEL[service].split(" ")[0]}
                    </span>
                    <span className="h-6 flex-1 overflow-hidden rounded bg-surface-2">
                      <span
                        className="block h-full rounded bg-accent"
                        style={{
                          width: `${Math.max((value / maxService) * 100, value > 0 ? 4 : 0)}%`,
                        }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right text-sm font-bold text-ink">
                      {value > 0 ? formatMoney(value) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Best neighbourhoods">
              {byNeighbourhood.length === 0 ? (
                <Empty>No addresses recorded yet.</Empty>
              ) : (
                <ul className="flex flex-col gap-2">
                  {byNeighbourhood.map(([zip, entry]) => (
                    <li
                      key={zip}
                      className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5"
                    >
                      <span>
                        <span className="block text-base font-bold text-ink">{zip}</span>
                        <span className="block text-sm font-semibold text-muted">
                          {entry.customers}{" "}
                          {entry.customers === 1 ? "pin" : "pins"}
                        </span>
                      </span>
                      <span className="text-base font-black text-accent">
                        {formatMoney(entry.revenue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="By person">
              <ul className="flex flex-col gap-2">
                {perUser.map((entry) => (
                  <li
                    key={entry.uid}
                    className="rounded-xl border border-line bg-surface-2 p-3"
                    style={{ borderLeft: `4px solid ${colorFor(entry.uid)}` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <UserChip name={entry.name} color={colorFor(entry.uid)} />
                      <span className="text-base font-black text-accent">
                        {formatMoney(entry.revenue)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold text-muted">
                      {entry.jobs} jobs · {entry.pins} pins logged · {entry.quotes} quotes
                      sent
                    </p>
                  </li>
                ))}
              </ul>
            </Section>

            <div className="py-6">
              <Link
                href="/dashboard"
                className="tap-target flex items-center justify-center rounded-xl border border-line bg-surface-2 px-4 py-3 text-base font-bold text-ink"
              >
                Back to today
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-lg font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
      {children}
    </p>
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
      <p className={`mt-0.5 text-xl font-black ${accent ? "text-accent" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}
