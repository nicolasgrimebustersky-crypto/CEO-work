"use client";

import { endOfWeek, format, isSameDay, startOfWeek } from "date-fns";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useDocuments } from "@/components/providers/DocumentsProvider";
import { useJobs } from "@/components/providers/JobsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { useOpenMenu } from "@/components/shell/menu";
import { MenuIcon } from "@/components/shell/navIcons";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { Spinner } from "@/components/ui/Spinner";
import { subscribeAllQuotes } from "@/lib/db/quotes";
import {
  compactMoney,
  formatChange,
  monthPeriod,
  periodCards,
  periodTotal,
  previousPeriod,
  yearPeriod,
} from "@/lib/documentPeriods";
import { customerName, formatMoney, initialsFor } from "@/lib/format";
import { routes } from "@/lib/routes";
import { SERVICE_LABEL } from "@/lib/status";
import type { Quote } from "@/lib/types";
import { readableInkOn } from "@/lib/userColor";

/**
 * The first screen of the day.
 *
 * Four questions, in the order they get asked with coffee in hand: how is the
 * month going, what is booked today, who is doing it, and what is waiting on
 * somebody else — money owed, estimates out. Everything here links to the
 * screen that answers it in full; nothing is editable from the dashboard.
 *
 * The month figure counts what was *invoiced*, same as the Money screen, so
 * the two never disagree. Money that has actually arrived is on Reports.
 */
export function DashboardScreen() {
  const { jobs, loading: jobsLoading } = useJobs();
  const { customers } = useCustomers();
  const { documents, outstanding, loading: documentsLoading } = useDocuments();
  const { users, author, colorFor, nameFor } = useTeam();
  const openMenu = useOpenMenu();
  const [quotes, setQuotes] = useState<Quote[]>([]);

  useEffect(() => subscribeAllQuotes(setQuotes), []);

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 0 });
  const thisMonth = monthPeriod(now.getFullYear(), now.getMonth());
  const thisYear = yearPeriod(now.getFullYear());

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
  const todayDone = todayJobs.filter((job) => job.status === "complete").length;

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
  const weekRevenue = completedThisWeek.reduce((sum, job) => sum + job.price, 0);

  // The month, in context: the last six months of invoicing as bars, this
  // one lit, and the change against last month as a number.
  const months = useMemo(
    () =>
      periodCards(documents, "invoice", now, {
        minMonths: 6,
        maxMonths: 6,
      }).slice(0, -1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documents],
  );
  const monthCard = months[months.length - 1];
  const lastMonthTotal = periodTotal(documents, previousPeriod(thisMonth), "invoice");
  const yearTotal = periodTotal(documents, thisYear, "invoice");

  // Estimates out with the customer: the new documents and the older quote
  // records both count, since either is a price somebody has not answered.
  const openEstimates = documents.filter((d) => d.kind === "estimate" && d.status === "sent");
  const openQuotes = quotes.filter((q) => q.status === "sent" || q.status === "no_response");
  const outForQuote =
    openEstimates.reduce((sum, d) => sum + d.total, 0) +
    openQuotes.reduce((sum, q) => sum + q.amount, 0);
  const outForQuoteCount = openEstimates.length + openQuotes.length;

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

  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = author?.displayName.split(/\s+/)[0] ?? "";
  const loading = jobsLoading || documentsLoading;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-canvas">
      <div
        aria-hidden
        className="gb-money-glow-money pointer-events-none absolute inset-x-0 top-0 h-[36vh]"
      />

      {/* ------------------------------------------------------------ top */}
      <header className="pt-safe relative z-10 shrink-0 px-4 pb-2">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-wide text-muted uppercase">
              {format(now, "EEEE, MMMM d")}
            </p>
            <h1 className="mt-0.5 text-2xl leading-tight font-extrabold tracking-tight text-ink sm:text-[2rem]">
              {greeting}
              {firstName ? `, ${firstName}` : ""}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <NotificationBell />
            {openMenu ? (
              <button
                type="button"
                onClick={openMenu}
                aria-label="Open menu"
                className="tap-target flex size-12 items-center justify-center rounded-full border border-line bg-surface-2/80 text-ink backdrop-blur hover:bg-surface-3"
              >
                <MenuIcon />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {/* --------------------------------------------------------- scroll */}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 pt-2 pb-8">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner label="Loading…" />
            </div>
          ) : (
            <>
              {/* Hero: the month */}
              <Link
                href={routes.invoices}
                className="block rounded-3xl border border-line bg-surface p-5 transition active:bg-surface-2"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-muted">
                      Invoiced in {format(now, "MMMM")}
                    </p>
                    <p className="mt-1 text-[2.4rem] leading-none font-extrabold tracking-tight text-money tabular-nums">
                      {formatMoney(monthCard?.total ?? 0)}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-muted">
                      {monthCard?.changePct === null || monthCard === undefined ? (
                        lastMonthTotal === 0 ? (
                          "Nothing invoiced last month"
                        ) : (
                          `${formatMoney(lastMonthTotal)} last month`
                        )
                      ) : (
                        <>
                          <span
                            className={`font-extrabold tabular-nums ${
                              monthCard.changePct >= 0 ? "text-money" : "text-danger"
                            }`}
                          >
                            {monthCard.changePct >= 0 ? "▲" : "▼"}{" "}
                            {formatChange(monthCard.changePct)}
                          </span>{" "}
                          vs {format(previousPeriod(thisMonth).startMs, "MMMM")}
                        </>
                      )}
                    </p>
                  </div>
                  <Sparkline months={months} />
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm font-semibold text-muted">
                  <span>
                    {format(now, "yyyy")} so far:{" "}
                    <span className="font-extrabold text-ink tabular-nums">
                      {formatMoney(yearTotal)}
                    </span>
                  </span>
                  <span className="text-accent">Open Money →</span>
                </div>
              </Link>

              {/* Four tiles */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile
                  href={routes.schedule}
                  label="Jobs today"
                  value={String(todayJobs.length)}
                  detail={
                    todayJobs.length === 0
                      ? "Nothing booked"
                      : `${formatMoney(todayRevenue)} expected${todayDone ? ` · ${todayDone} done` : ""}`
                  }
                  icon={<CalendarGlyph />}
                  tone="accent"
                />
                <Tile
                  href={routes.invoices}
                  label="Owed to you"
                  value={compactMoney(outstanding)}
                  detail={outstanding > 0 ? "Across open invoices" : "Everyone has paid"}
                  icon={<CoinGlyph />}
                  tone={outstanding > 0 ? "warn" : "money"}
                />
                <Tile
                  href={routes.schedule}
                  label="Done this week"
                  value={String(completedThisWeek.length)}
                  detail={
                    completedThisWeek.length === 0
                      ? "No jobs finished yet"
                      : `${formatMoney(weekRevenue)} of work`
                  }
                  icon={<CheckGlyph />}
                  tone="money"
                />
                <Tile
                  href={routes.pipeline}
                  label="Out for quote"
                  value={String(outForQuoteCount)}
                  detail={
                    outForQuoteCount === 0
                      ? "No estimates waiting"
                      : `${formatMoney(outForQuote)} waiting on a yes`
                  }
                  icon={<QuoteGlyph />}
                  tone="accent"
                />
              </div>

              {/* Today's schedule */}
              <section className="rounded-3xl border border-line bg-surface">
                <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
                  <h2 className="text-lg font-extrabold text-ink">Today&apos;s schedule</h2>
                  <Link
                    href={routes.schedule}
                    className="tap-target -mr-2 inline-flex items-center rounded-full px-3 text-sm font-bold text-accent"
                  >
                    Calendar →
                  </Link>
                </div>

                {todayJobs.length === 0 ? (
                  <p className="px-5 pb-5 text-base font-semibold text-muted">
                    Nothing scheduled today. A good day to knock some doors.
                  </p>
                ) : (
                  <ol className="px-2 pb-2">
                    {todayJobs.map((job, index) => {
                      const customer = customers.find((c) => c.id === job.customerId);
                      const done = job.status === "complete";
                      return (
                        <li key={job.id}>
                          <Link
                            href={routes.customer(job.customerId)}
                            className="flex items-stretch gap-3 rounded-2xl px-3 py-2.5 active:bg-surface-2"
                          >
                            <span className="flex w-16 shrink-0 flex-col items-center">
                              <span
                                className={`text-sm font-extrabold tabular-nums ${
                                  done ? "text-muted line-through" : "text-ink"
                                }`}
                              >
                                {format(job.scheduledStart.toDate(), "h:mm")}
                              </span>
                              <span className="text-xs font-bold text-muted">
                                {format(job.scheduledStart.toDate(), "a")}
                              </span>
                              {index < todayJobs.length - 1 ? (
                                <span aria-hidden className="mt-1 w-px flex-1 bg-line" />
                              ) : null}
                            </span>
                            <span className="min-w-0 flex-1 pb-1">
                              <span className="flex items-start justify-between gap-2">
                                <span
                                  className={`truncate text-base font-bold ${
                                    done ? "text-muted" : "text-ink"
                                  }`}
                                >
                                  {customer ? customerName(customer) : "Unknown customer"}
                                </span>
                                <span className="shrink-0 text-base font-extrabold text-money tabular-nums">
                                  {formatMoney(job.price)}
                                </span>
                              </span>
                              <span className="mt-0.5 block text-sm font-semibold text-muted">
                                {SERVICE_LABEL[job.serviceType]}
                                {done
                                  ? " · Done"
                                  : job.status === "in_progress"
                                    ? " · On site"
                                    : ""}
                              </span>
                              <span className="mt-1.5 flex flex-wrap gap-1">
                                {job.assignedTo.map((uid) => (
                                  <span
                                    key={uid}
                                    className="rounded-full px-2 py-0.5 text-xs font-bold"
                                    style={{
                                      backgroundColor: colorFor(uid),
                                      color: readableInkOn(colorFor(uid)),
                                    }}
                                  >
                                    {nameFor(uid)}
                                  </span>
                                ))}
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              {/* Crew */}
              <section>
                <h2 className="mb-2 px-1 text-lg font-extrabold text-ink">Crew today</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {users.map((user) => {
                    const mine = todayJobs.filter((job) => job.assignedTo.includes(user.uid));
                    const revenue = mine.reduce((sum, job) => sum + job.price, 0);
                    const color = colorFor(user.uid);
                    return (
                      <div
                        key={user.uid}
                        className="flex items-center gap-3.5 rounded-3xl border border-line bg-surface p-4"
                      >
                        <span
                          aria-hidden
                          className="flex size-12 shrink-0 items-center justify-center rounded-full text-base font-extrabold"
                          style={{
                            backgroundColor: color,
                            color: readableInkOn(color),
                          }}
                        >
                          {initialsFor(user.displayName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-bold text-ink">
                            {user.displayName}
                          </span>
                          <span className="block text-sm font-semibold text-muted">
                            {mine.length} {mine.length === 1 ? "job" : "jobs"} today ·{" "}
                            {knocksThisWeek.get(user.uid) ?? 0} doors this week
                          </span>
                        </span>
                        <span className="shrink-0 text-lg font-extrabold text-money tabular-nums">
                          {formatMoney(revenue)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Shortcuts */}
              <section className="grid grid-cols-4 gap-2">
                <Shortcut href={routes.map} label="Map" icon={<MapGlyph />} />
                <Shortcut href={routes.pipeline} label="Leads" icon={<LeadsGlyph />} />
                <Shortcut href={routes.messages} label="Texts" icon={<TextsGlyph />} />
                <Shortcut href={routes.reports} label="Reports" icon={<ReportsGlyph />} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

const TONE = {
  accent: "bg-accent/15 text-accent",
  money: "bg-money/15 text-money",
  warn: "bg-warn/15 text-warn",
} as const;

function Tile({
  href,
  label,
  value,
  detail,
  icon,
  tone,
}: {
  href: string;
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone: keyof typeof TONE;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col rounded-3xl border border-line bg-surface p-4 transition active:bg-surface-2"
    >
      <span className={`flex size-10 items-center justify-center rounded-full ${TONE[tone]}`}>
        {icon}
      </span>
      <span className="mt-3 text-[1.75rem] leading-none font-extrabold tracking-tight text-ink tabular-nums">
        {value}
      </span>
      <span className="mt-1.5 text-sm font-bold text-ink">{label}</span>
      <span className="mt-0.5 text-xs font-semibold text-muted">{detail}</span>
    </Link>
  );
}

/**
 * Six bars, one per month, the current one lit. Heights are relative to the
 * biggest month in the window, with a floor so an empty month still shows as
 * a stub rather than vanishing — a missing bar reads as missing data.
 */
function Sparkline({ months }: { months: ReturnType<typeof periodCards> }) {
  const max = Math.max(1, ...months.map((m) => m.total));
  return (
    <div
      role="img"
      aria-label={`Invoiced by month: ${months
        .map((m) => `${m.period.label} ${compactMoney(m.total)}`)
        .join(", ")}`}
      className="flex h-16 shrink-0 items-end gap-1.5"
    >
      {months.map((m, index) => {
        const current = index === months.length - 1;
        const height = Math.max(8, Math.round((m.total / max) * 100));
        return (
          <span
            key={m.period.key}
            className={`w-2.5 rounded-full ${current ? "bg-money" : "bg-money/30"}`}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

function Shortcut({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-surface py-3 text-xs font-bold text-muted transition active:bg-surface-2"
    >
      <span className="text-ink">{icon}</span>
      {label}
    </Link>
  );
}

/* -------------------------------------------------------------- glyphs */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="3" {...stroke} />
      <path d="M3.5 10h17M8 3v4M16 3v4" {...stroke} />
    </svg>
  );
}
function CoinGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path
        d="M12 7.5v9M14.5 9.5c0-1-1.1-1.5-2.5-1.5s-2.5.6-2.5 1.6c0 2.4 5 1.2 5 3.7 0 1-1.1 1.7-2.5 1.7s-2.5-.7-2.5-1.7"
        {...stroke}
      />
    </svg>
  );
}
function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" {...stroke} />
    </svg>
  );
}
function QuoteGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" {...stroke} />
      <path d="M9.5 12h5M9.5 15.5h5" {...stroke} />
    </svg>
  );
}
function MapGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5V6.5ZM9 4v13.5M15 6.5V20"
        {...stroke}
      />
    </svg>
  );
}
function LeadsGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path d="M4 5h16M6.5 12h11M9.5 19h5" {...stroke} strokeWidth={2.2} />
    </svg>
  );
}
function TextsGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5v-8Z"
        {...stroke}
      />
    </svg>
  );
}
function ReportsGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path d="M5 20V11M12 20V5M19 20v-7" {...stroke} strokeWidth={2.4} />
    </svg>
  );
}
