"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Chip } from "@/components/ui/Chips";
import { subscribeExpenses, type Expense } from "@/lib/db/expenses";
import { expenseTotals } from "@/lib/expenses";
import { formatMoney } from "@/lib/format";
import { routes } from "@/lib/routes";
import {
  FILING_STATUS_LABEL,
  atYearPace,
  estimateTax,
  nextEstimatedPaymentDue,
  taxYearFor,
  type FilingStatus,
} from "@/lib/taxEstimate";

const SETTINGS_KEY = "taxEstimate.settings";

interface Settings {
  filing: FilingStatus;
  /** Local occupational tax, percent, e.g. 2.2 for Louisville residents. */
  localPercent: number;
}

const DEFAULTS: Settings = { filing: "single", localPercent: 0 };

/** Per-phone, because it describes the person reading, not the business. */
function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      filing: parsed.filing === "joint" ? "joint" : "single",
      localPercent:
        typeof parsed.localPercent === "number" && parsed.localPercent >= 0 && parsed.localPercent <= 10
          ? parsed.localPercent
          : 0,
    };
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(settings: Settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private window or blocked storage: the setting lasts this visit only.
  }
}

/**
 * Tax to set aside for the year: profit (money in, less expenses) run through
 * self-employment, federal and Kentucky income tax, shown so far and carried
 * on to 31 December at the year's pace, less any estimated payments logged.
 */
export function TaxEstimateSection({ year, grossSoFar }: { year: number; grossSoFar: number }) {
  const { author } = useTeam();
  const uid = author?.uid ?? "";
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [localInput, setLocalInput] = useState("");

  // Mounted for the owner only (ReportsScreen), so this reads every expense.
  useEffect(() => {
    if (!uid) return;
    return subscribeExpenses({ uid, isOwner: true }, setExpenses, () => setExpenses([]));
  }, [uid]);
  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    setLocalInput(loaded.localPercent ? String(loaded.localPercent) : "");
  }, []);

  function update(next: Settings) {
    setSettings(next);
    saveSettings(next);
  }

  const totals = useMemo(() => expenseTotals(expenses ?? [], year), [expenses, year]);
  const { exact } = taxYearFor(year);
  const options = { year, filing: settings.filing, localRate: settings.localPercent / 100 };

  const profitSoFar = grossSoFar - totals.deductible;
  const soFar = estimateTax(profitSoFar, options);
  const grossAtPace = atYearPace(grossSoFar, year);
  const expensesAtPace = atYearPace(totals.deductible, year);
  const fullYear = estimateTax(grossAtPace - expensesAtPace, options);
  const stillToSetAside = Math.max(0, fullYear.total - totals.taxPaid);
  const due = nextEstimatedPaymentDue();
  const isCurrentYear = new Date().getFullYear() === year;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-lg font-bold text-ink">Tax to set aside, {year}</h2>

      <div className="rounded-2xl border border-gold/60 bg-gold/10 p-3">
        <p className="text-sm font-bold tracking-wide text-gold uppercase">
          {isCurrentYear ? "Expected for the full year" : "Estimated for the year"}
        </p>
        <p className="mt-0.5 text-3xl font-extrabold text-ink tabular-nums">
          {formatMoney(isCurrentYear ? fullYear.total : soFar.total)}
        </p>
        <p className="mt-1 text-sm font-semibold text-muted">
          About {Math.round((isCurrentYear ? fullYear : soFar).effectiveRate * 100)}% of profit.
          {totals.taxPaid > 0
            ? ` ${formatMoney(totals.taxPaid)} already paid — ${formatMoney(stillToSetAside)} still to cover.`
            : ""}
        </p>
        {isCurrentYear ? (
          <p className="mt-1 text-sm font-semibold text-muted">
            On what has come in so far: {formatMoney(soFar.total)}. The full-year figure carries this
            year&apos;s pace on to 31 December.
          </p>
        ) : null}
      </div>

      <ul className="mt-2 flex flex-col gap-1.5">
        <Line label="Money in" value={isCurrentYear ? grossAtPace : grossSoFar} />
        <Line
          label="Less expenses"
          value={-(isCurrentYear ? expensesAtPace : totals.deductible)}
          link={routes.expenses}
        />
        <Line label="Profit" value={(isCurrentYear ? fullYear : soFar).profit} bold />
        <Line label="Self-employment tax (15.3%)" value={(isCurrentYear ? fullYear : soFar).selfEmploymentTax} />
        <Line label="Federal income tax" value={(isCurrentYear ? fullYear : soFar).federalIncomeTax} />
        <Line label="Kentucky income tax (3.5%)" value={(isCurrentYear ? fullYear : soFar).kentuckyIncomeTax} />
        {settings.localPercent > 0 ? (
          <Line
            label={`Local occupational tax (${settings.localPercent}%)`}
            value={(isCurrentYear ? fullYear : soFar).localTax}
          />
        ) : null}
      </ul>

      <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
        <p className="text-base font-bold text-ink">
          Next estimated payment due{" "}
          {due.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>
        <p className="mt-1 text-sm font-semibold text-muted">
          The IRS expects tax paid through the year, in four parts, not all in April — owing more
          than $1,000 at filing with nothing paid in brings an underpayment penalty. Log each payment
          as a &ldquo;Tax payment&rdquo; expense and it comes off what is left to cover.
        </p>
      </div>

      <div className="mt-3 rounded-xl border border-warn/60 bg-warn/10 p-3">
        <p className="text-base font-bold text-ink">Sales tax is separate</p>
        <p className="mt-1 text-sm font-semibold text-muted">
          Kentucky taxes some services (janitorial and landscaping among them). Whether window
          cleaning and pressure washing count is a question for an accountant; if they do, that tax is
          collected from customers and is not in the figure above.
        </p>
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-sm font-semibold text-muted">Filing as</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FILING_STATUS_LABEL) as FilingStatus[]).map((f) => (
            <Chip key={f} active={settings.filing === f} onClick={() => update({ ...settings, filing: f })}>
              {FILING_STATUS_LABEL[f]}
            </Chip>
          ))}
        </div>
        <label className="mt-3 block text-sm font-semibold text-muted">
          City or county occupational tax, % of profit (Louisville Metro residents pay 2.2%)
          <input
            inputMode="decimal"
            placeholder="0"
            value={localInput}
            onChange={(e) => {
              setLocalInput(e.target.value);
              const value = Number(e.target.value);
              if (e.target.value.trim() === "") update({ ...settings, localPercent: 0 });
              else if (Number.isFinite(value) && value >= 0 && value <= 10) {
                update({ ...settings, localPercent: value });
              }
            }}
            className="tap-target mt-1.5 w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      <p className="mt-3 text-sm font-semibold text-muted">
        A set-aside figure, not a tax return. It assumes this business is the only income, the standard
        deduction, and {year} rates
        {exact ? "" : " (this year's rates aren't loaded yet, so last known year's are used)"}. A second job,
        a spouse&apos;s income, or equipment bought on credit all change the real number — an accountant
        settles it. Expenses with no receipt are counted here, but may not survive an audit.
      </p>
    </section>
  );
}

function Line({
  label,
  value,
  bold = false,
  link,
}: {
  label: string;
  value: number;
  bold?: boolean;
  link?: string;
}) {
  const content = (
    <>
      <span className={`text-base ${bold ? "font-extrabold text-ink" : "font-semibold text-muted"}`}>
        {label}
        {link ? " ›" : ""}
      </span>
      <span className={`text-base tabular-nums ${bold ? "font-extrabold text-ink" : "font-bold text-ink"}`}>
        {value < 0 ? `−${formatMoney(-value)}` : formatMoney(value)}
      </span>
    </>
  );
  return (
    <li>
      {link ? (
        <Link href={link} className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2 hover:bg-surface-3">
          {content}
        </Link>
      ) : (
        <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2">
          {content}
        </div>
      )}
    </li>
  );
}
