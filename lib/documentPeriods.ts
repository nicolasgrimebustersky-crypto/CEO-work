/**
 * The month cards across the top of the Money screen.
 *
 * The screen reads as a row of periods — each month with what was raised in
 * it and how that compares to the month before, then the year as a whole —
 * with one selected, and the list underneath showing only that period. This
 * file is the arithmetic behind those cards: which periods to show, what each
 * one adds up to, and how a figure is shortened to fit on a card.
 *
 * Money is counted by *issue date*, not by payment. That is the question this
 * screen answers — "what did we bill in March" — and it is a different one
 * from lib/money/summary.ts, which counts what arrived. Void documents are
 * left out everywhere: a voided invoice was a mistake, not revenue.
 *
 * Free of imports so it runs under `node --test` with nothing mocked.
 */

/** The bits of a document this file reads. Firestore's Timestamp fits. */
export interface PeriodDocument {
  kind: "estimate" | "invoice";
  status: string;
  total: number;
  balanceDue: number;
  issuedAt: { toMillis(): number } | null;
}

export interface Period {
  /** "2026-03" for a month, "2026" for a year. */
  key: string;
  /** What the card says: "Mar 2026" or "2026". */
  label: string;
  /** What the bar above the cards says: "March 2026" or "Total 2026". */
  heading: string;
  grain: "month" | "year";
  /** Inclusive start and exclusive end, in local time. */
  startMs: number;
  endMs: number;
}

export interface PeriodCard {
  period: Period;
  total: number;
  /**
   * Change against the previous period of the same length, in percent, or
   * null when the previous one was zero — "up from nothing" is not a number.
   */
  changePct: number | null;
  count: number;
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function monthPeriod(year: number, monthIndex: number): Period {
  // Date normalises month 12 into the next year, which is what makes the
  // end-of-December boundary come out right without special-casing it.
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 1);
  const y = start.getFullYear();
  const m = start.getMonth();
  return {
    key: `${y}-${String(m + 1).padStart(2, "0")}`,
    label: `${MONTHS_SHORT[m]} ${y}`,
    heading: `${MONTHS_LONG[m]} ${y}`,
    grain: "month",
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

export function yearPeriod(year: number): Period {
  return {
    key: String(year),
    label: String(year),
    heading: `Total ${year}`,
    grain: "year",
    startMs: new Date(year, 0, 1).getTime(),
    endMs: new Date(year + 1, 0, 1).getTime(),
  };
}

/** The same period, one step back. */
export function previousPeriod(period: Period): Period {
  const start = new Date(period.startMs);
  return period.grain === "month"
    ? monthPeriod(start.getFullYear(), start.getMonth() - 1)
    : yearPeriod(start.getFullYear() - 1);
}

function issuedMs(document: PeriodDocument): number | null {
  const stamp = document.issuedAt;
  if (!stamp || typeof stamp.toMillis !== "function") return null;
  const ms = stamp.toMillis();
  return Number.isFinite(ms) ? ms : null;
}

export function inPeriod(document: PeriodDocument, period: Period): boolean {
  const ms = issuedMs(document);
  return ms !== null && ms >= period.startMs && ms < period.endMs;
}

/** Everything of one kind issued in the period, void ones left out. */
export function documentsIn<T extends PeriodDocument>(
  documents: readonly T[],
  period: Period,
  kind: PeriodDocument["kind"],
): T[] {
  return documents.filter(
    (document) =>
      document.kind === kind && document.status !== "void" && inPeriod(document, period),
  );
}

export function periodTotal(
  documents: readonly PeriodDocument[],
  period: Period,
  kind: PeriodDocument["kind"],
): number {
  return round2(
    documentsIn(documents, period, kind).reduce((sum, document) => sum + document.total, 0),
  );
}

/**
 * Which periods get a card.
 *
 * Every month back to the earliest document of this kind, so nothing that was
 * ever billed is unreachable — but at least six months so a new book still
 * looks like a row, and at most twelve so the dots stay countable. Then the
 * current year. Always ends on the current month, even if it is empty: the
 * card you land on should be *now*.
 */
export function periodsFor(
  documents: readonly PeriodDocument[],
  kind: PeriodDocument["kind"],
  now: Date = new Date(),
  { minMonths = 6, maxMonths = 12 }: { minMonths?: number; maxMonths?: number } = {},
): Period[] {
  let earliest = Infinity;
  for (const document of documents) {
    if (document.kind !== kind || document.status === "void") continue;
    const ms = issuedMs(document);
    if (ms !== null && ms < earliest) earliest = ms;
  }

  let monthsBack = minMonths;
  if (earliest !== Infinity) {
    const first = new Date(earliest);
    const span =
      (now.getFullYear() - first.getFullYear()) * 12 + (now.getMonth() - first.getMonth()) + 1;
    monthsBack = Math.max(minMonths, span);
  }
  monthsBack = Math.min(maxMonths, Math.max(1, monthsBack));

  const months: Period[] = [];
  for (let back = monthsBack - 1; back >= 0; back--) {
    months.push(monthPeriod(now.getFullYear(), now.getMonth() - back));
  }
  return [...months, yearPeriod(now.getFullYear())];
}

/** Percent change from `before` to `after`, one decimal, or null from zero. */
export function percentChange(before: number, after: number): number | null {
  if (before <= 0) return null;
  return Math.round(((after - before) / before) * 1000) / 10;
}

export function periodCards(
  documents: readonly PeriodDocument[],
  kind: PeriodDocument["kind"],
  now: Date = new Date(),
  options?: { minMonths?: number; maxMonths?: number },
): PeriodCard[] {
  return periodsFor(documents, kind, now, options).map((period) => {
    const total = periodTotal(documents, period, kind);
    const before = periodTotal(documents, previousPeriod(period), kind);
    return {
      period,
      total,
      changePct: percentChange(before, total),
      count: documentsIn(documents, period, kind).length,
    };
  });
}

/** Still owed on invoices issued in the period. */
export function balanceDueIn(documents: readonly PeriodDocument[], period: Period): number {
  return round2(
    documentsIn(documents, period, "invoice")
      .filter((document) => document.status === "sent" || document.status === "partial")
      .reduce((sum, document) => sum + Math.max(0, document.balanceDue), 0),
  );
}

/** Estimates issued in the period that the customer has not yet answered. */
export function pendingIn(documents: readonly PeriodDocument[], period: Period): number {
  return round2(
    documentsIn(documents, period, "estimate")
      .filter((document) => document.status === "sent" || document.status === "draft")
      .reduce((sum, document) => sum + document.total, 0),
  );
}

/**
 * A figure short enough for a card: $652, $4.62K, $12.3K, $1.2M.
 *
 * Three significant digits once it needs a suffix — enough to tell two months
 * apart at a glance, not enough to pretend a card is an invoice. The exact
 * figure is on the big number under the cards.
 */
export function compactMoney(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs < 1000) return `${sign}$${Math.round(abs)}`;
  const [value, suffix] = abs < 1_000_000 ? [abs / 1000, "K"] : [abs / 1_000_000, "M"];
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  // toFixed then strip a trailing ".0" or ".00": "$5.00K" reads as a mistake.
  const text = value.toFixed(digits).replace(/\.?0+$/, "");
  return `${sign}$${text}${suffix}`;
}

/** "▲ 204%" territory: the sign is the caller's, this is just the number. */
export function formatChange(changePct: number | null): string {
  if (changePct === null) return "—";
  const rounded = Math.abs(changePct) >= 10 ? Math.round(changePct) : changePct;
  return `${Math.abs(rounded)}%`;
}
