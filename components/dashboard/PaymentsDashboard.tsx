"use client";

import { endOfMonth, format, startOfMonth, startOfYear, subDays, subMonths } from "date-fns";
import { useMemo, useState } from "react";

import { Chip } from "@/components/ui/Chips";
import { formatMoney, formatMoneyExact } from "@/lib/format";
import {
  byDay,
  byMethod,
  collectedIn,
  paymentEvents,
  unpaidIn,
  type Bucket,
  type DashInvoice,
  type DashJob,
  type MethodShare,
  type Range,
} from "@/lib/money/payments";

type PeriodKey = "month" | "last_month" | "30d" | "year";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "30d", label: "30 days" },
  { key: "year", label: "This year" },
];

function rangeFor(key: PeriodKey, now: Date): Range {
  switch (key) {
    case "month":
      return { startMs: startOfMonth(now).getTime(), endMs: now.getTime() + 1 };
    case "last_month": {
      const last = subMonths(now, 1);
      return { startMs: startOfMonth(last).getTime(), endMs: endOfMonth(last).getTime() + 1 };
    }
    case "30d": {
      const start = subDays(now, 29);
      start.setHours(0, 0, 0, 0);
      return { startMs: start.getTime(), endMs: now.getTime() + 1 };
    }
    case "year":
      return { startMs: startOfYear(now).getTime(), endMs: now.getTime() + 1 };
  }
}

/** Shades of the brand green, then greys — the order slices are drawn in. */
const SLICE_COLORS = ["#06a143", "#2fbf6a", "#7fd9a3", "#9ba7b4", "#5f6b78", "#3a434d", "#262b33"];

/**
 * Payments at a glance: four figures, money by day, and how it was paid.
 *
 * Laid out after the payments screen the owner liked in another field-service
 * app, in this app's own colours. All arithmetic is in lib/money/payments.ts.
 */
export function PaymentsDashboard({
  jobs,
  invoices,
}: {
  jobs: readonly DashJob[];
  invoices: readonly DashInvoice[];
}) {
  const [period, setPeriod] = useState<PeriodKey>("month");

  const view = useMemo(() => {
    const now = new Date();
    const range = rangeFor(period, now);
    const events = paymentEvents(jobs, invoices);
    return {
      // byDay groups anything longer than two months by week.
      weekly: range.endMs - range.startMs > 62 * 86_400_000,
      collected: collectedIn(events, range),
      days: byDay(events, range),
      methods: byMethod(events, range),
      unpaid: unpaidIn(jobs, invoices, range, now.getTime()),
    };
  }, [jobs, invoices, period]);

  const { collected, unpaid } = view;

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Payments</h2>
      </div>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {PERIODS.map((option) => (
          <Chip
            key={option.key}
            active={period === option.key}
            onClick={() => setPeriod(option.key)}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Kpi
          label="Payments collected"
          value={formatMoney(collected.total)}
          tone="money"
          note={`${collected.count} ${collected.count === 1 ? "payment" : "payments"}`}
        />
        <Kpi
          label="Unpaid jobs"
          value={`${(unpaid.unpaidShare * 100).toFixed(1)}%`}
          tone={unpaid.unpaidJobs > 0 ? "danger" : "ink"}
          note={`${unpaid.unpaidJobs} of ${unpaid.finishedJobs} finished`}
        />
        <Kpi
          label="Unpaid balance"
          value={formatMoney(unpaid.balance)}
          tone={unpaid.balance > 0 ? "danger" : "ink"}
          note={
            unpaid.oldestDays === null
              ? "Nothing owed"
              : `Oldest ${unpaid.oldestDays} ${unpaid.oldestDays === 1 ? "day" : "days"}`
          }
        />
        <Kpi
          label="Average payment"
          value={formatMoney(collected.average)}
          tone="ink"
          note={`Across ${collected.count} ${collected.count === 1 ? "payment" : "payments"}`}
        />
      </div>

      <div className="mt-2 rounded-2xl border border-line bg-surface-2 p-3">
        <p className="text-sm font-bold text-muted">
          Payments by {view.weekly ? "week" : "day"}
        </p>
        <AreaChart buckets={view.days} />
      </div>

      <div className="mt-2 rounded-2xl border border-line bg-surface-2 p-3">
        <p className="text-sm font-bold text-muted">How it was paid</p>
        {view.methods.length === 0 ? (
          <p className="py-6 text-center text-base font-semibold text-muted">
            No payments in this period.
          </p>
        ) : (
          <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row">
            <Donut slices={view.methods} total={collected.total} />
            <ul className="flex w-full flex-col gap-2">
              {view.methods.map((slice, index) => (
                <li key={slice.method} className="flex items-center gap-2 text-sm">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: SLICE_COLORS[index % SLICE_COLORS.length] }}
                  />
                  <span className="flex-1 font-semibold text-ink">{slice.method}</span>
                  <span className="font-bold text-ink tabular-nums">
                    {formatMoneyExact(slice.total)}
                  </span>
                  <span className="w-12 text-right font-semibold text-muted tabular-nums">
                    {(slice.share * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "money" | "danger" | "ink";
}) {
  const color = tone === "money" ? "text-money" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-surface-2 px-3 py-3">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${color}`}>{value}</p>
      <p className="mt-0.5 text-xs font-semibold text-muted">{note}</p>
    </div>
  );
}

const CHART_W = 320;
const CHART_H = 140;
const PAD_LEFT = 34;
const PAD_BOTTOM = 18;

/** "$1.7K", "$520", "$0" — short enough for the axis. */
function axisMoney(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(value)}`;
}

/**
 * A smoothed line with a soft fill under it. Drawn by hand in SVG rather than
 * through a chart library: it is one shape, and a library would be most of
 * the page's weight for it.
 */
function AreaChart({ buckets }: { buckets: Bucket[] }) {
  // A line through one point, or through nothing but zeros, is not a chart.
  if (buckets.length < 2 || buckets.every((bucket) => bucket.total === 0)) {
    return (
      <p className="py-6 text-center text-base font-semibold text-muted">
        {buckets.length < 2 ? "Not enough days yet to draw." : "No payments in this period."}
      </p>
    );
  }
  const max = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const plotW = CHART_W - PAD_LEFT;
  const plotH = CHART_H - PAD_BOTTOM;
  const step = buckets.length > 1 ? plotW / (buckets.length - 1) : 0;
  const points = buckets.map((bucket, index) => ({
    x: PAD_LEFT + index * step,
    y: 6 + (plotH - 6) * (1 - bucket.total / max),
  }));

  // Catmull-Rom through the points, as cubic Béziers. Clamped so a spike
  // never curves below zero.
  let line = "";
  points.forEach((point, index) => {
    if (index === 0) {
      line = `M${point.x},${point.y}`;
      return;
    }
    const p0 = points[index - 2] ?? points[index - 1];
    const p1 = points[index - 1];
    const p2 = point;
    const p3 = points[index + 1] ?? point;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = Math.min(plotH, p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = Math.min(plotH, p2.y - (p3.y - p1.y) / 6);
    line += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  });
  const area =
    points.length > 0
      ? `${line} L${points[points.length - 1].x},${plotH} L${points[0].x},${plotH} Z`
      : "";

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    y: 6 + (plotH - 6) * (1 - fraction),
    label: axisMoney(max * fraction),
  }));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="mt-2 w-full" role="img" aria-label="Payments over time">
      <defs>
        <linearGradient id="pay-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06a143" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#06a143" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => (
        <g key={tick.y}>
          <line x1={PAD_LEFT} x2={CHART_W} y1={tick.y} y2={tick.y} stroke="#262b33" strokeWidth="1" />
          <text x={PAD_LEFT - 4} y={tick.y + 3} textAnchor="end" fontSize="8" fill="#9ba7b4">
            {tick.label}
          </text>
        </g>
      ))}
      {area ? <path d={area} fill="url(#pay-fill)" /> : null}
      {line ? <path d={line} fill="none" stroke="#06a143" strokeWidth="2" strokeLinejoin="round" /> : null}
      {buckets.map((bucket, index) =>
        index % labelEvery === 0 ? (
          <text
            key={bucket.startMs}
            x={PAD_LEFT + index * step}
            y={CHART_H - 4}
            textAnchor="middle"
            fontSize="8"
            fill="#9ba7b4"
          >
            {format(bucket.startMs, buckets.length > 40 ? "MMM d" : "d")}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** The method split as a ring, with the total in the middle. */
function Donut({ slices, total }: { slices: MethodShare[]; total: number }) {
  const radius = 54;
  const stroke = 18;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" className="size-40 shrink-0" role="img" aria-label="Payment methods">
      <circle cx="70" cy="70" r={radius} fill="none" stroke="#1e232a" strokeWidth={stroke} />
      {slices.map((slice, index) => {
        const length = slice.share * circumference;
        // A hairline gap between slices, unless there is only one.
        const gap = slices.length > 1 ? Math.min(2, length / 2) : 0;
        const dash = `${Math.max(0, length - gap)} ${circumference}`;
        const node = (
          <circle
            key={slice.method}
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={SLICE_COLORS[index % SLICE_COLORS.length]}
            strokeWidth={stroke}
            strokeDasharray={dash}
            strokeDashoffset={-offset}
            transform="rotate(-90 70 70)"
          />
        );
        offset += length;
        return node;
      })}
      <text x="70" y="64" textAnchor="middle" fontSize="9" fontWeight="700" fill="#9ba7b4" letterSpacing="1">
        TOTAL
      </text>
      <text x="70" y="80" textAnchor="middle" fontSize="13" fontWeight="800" fill="#f7fafc">
        {formatMoneyExact(total)}
      </text>
    </svg>
  );
}
