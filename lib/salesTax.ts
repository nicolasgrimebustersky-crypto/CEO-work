/**
 * Sales tax: what the business charged and collected, per filing period.
 *
 * Kentucky taxes landscaping and lawn care at 6% (103 KAR 26:131). The
 * business collects it from customers and sends it to the state on a return
 * due the 20th of the month after each filing period; the Department of
 * Revenue assigns each permit a monthly, quarterly or annual frequency.
 *
 * Two figures per period, because they answer different questions:
 *   - Charged: tax on invoices issued in the period (not drafts, not void).
 *     What a return generally reports — tax is owed on the sale.
 *   - Collected: the tax share of payments actually received in the period.
 *     What has come in, so whether the money to pay the return is there.
 * The accountant decides which the return uses; the screen shows both.
 *
 * Every document keeps the tax rate and amount it was issued with, so a
 * change of settings never rewrites what an old invoice charged.
 *
 * Free of imports so it is tested by calling it.
 */

export const FILING_FREQUENCIES = ["monthly", "quarterly", "annual"] as const;
export type FilingFrequency = (typeof FILING_FREQUENCIES)[number];

export const FILING_FREQUENCY_LABEL: Record<FilingFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Once a year",
};

export interface SalesTaxSettings {
  /** Track tax owed and print the permit number on new invoices. */
  enabled: boolean;
  /** The state's sales and use tax permit (account) number. Printed on invoices. */
  permitNumber: string;
  filingFrequency: FilingFrequency;
  /** The rate new estimates and invoices start with, in percent. */
  defaultRatePct: number;
}

export const KENTUCKY_RATE_PCT = 6;

/** Settings as stored, or `fallback` field by field when missing or malformed. */
export function asSalesTaxSettings(raw: unknown, fallback: SalesTaxSettings): SalesTaxSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rate = r.defaultRatePct;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : fallback.enabled,
    permitNumber:
      typeof r.permitNumber === "string" ? r.permitNumber.trim().slice(0, 40) : fallback.permitNumber,
    filingFrequency: FILING_FREQUENCIES.includes(r.filingFrequency as FilingFrequency)
      ? (r.filingFrequency as FilingFrequency)
      : fallback.filingFrequency,
    defaultRatePct:
      typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 20
        ? rate
        : fallback.defaultRatePct,
  };
}

export interface FilingPeriod {
  /** "2026-05", "2026-Q2" or "2026". */
  key: string;
  label: string;
  /** Local midnight at the start, inclusive; end exclusive. Epoch ms. */
  startMs: number;
  endMs: number;
  /** The 20th of the month after the period ends, local midnight. */
  dueMs: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The filing period containing `at`. */
export function periodContaining(at: Date, frequency: FilingFrequency): FilingPeriod {
  const y = at.getFullYear();
  const m = at.getMonth();
  let startMonth: number;
  let months: number;
  let key: string;
  let label: string;
  if (frequency === "monthly") {
    startMonth = m;
    months = 1;
    key = `${y}-${String(m + 1).padStart(2, "0")}`;
    label = `${MONTHS[m]} ${y}`;
  } else if (frequency === "quarterly") {
    const q = Math.floor(m / 3);
    startMonth = q * 3;
    months = 3;
    key = `${y}-Q${q + 1}`;
    label = `Q${q + 1} ${y} (${MONTHS[startMonth]}–${MONTHS[startMonth + 2]})`;
  } else {
    startMonth = 0;
    months = 12;
    key = String(y);
    label = String(y);
  }
  const start = new Date(y, startMonth, 1);
  const end = new Date(y, startMonth + months, 1);
  const due = new Date(end.getFullYear(), end.getMonth(), 20);
  return { key, label, startMs: start.getTime(), endMs: end.getTime(), dueMs: due.getTime() };
}

/** The `count` periods ending with the one containing `at`, newest first. */
export function recentPeriods(at: Date, frequency: FilingFrequency, count: number): FilingPeriod[] {
  const out: FilingPeriod[] = [];
  let cursor = periodContaining(at, frequency);
  for (let i = 0; i < count; i += 1) {
    out.push(cursor);
    cursor = periodContaining(new Date(cursor.startMs - 1), frequency);
  }
  return out;
}

export interface TaxStamp {
  toMillis(): number;
}

export interface TaxInvoice {
  kind: string;
  status: string;
  issuedAt?: TaxStamp | null;
  total: number;
  taxAmount: number;
  payments?: readonly { amount: number; receivedAt?: TaxStamp | null }[] | null;
}

export interface PeriodTax {
  period: FilingPeriod;
  /** Tax on invoices issued in the period. */
  charged: number;
  /** Tax share of payments received in the period. */
  collected: number;
  /** Invoices issued in the period that carried any tax. */
  invoiceCount: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const usable = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function within(stamp: TaxStamp | null | undefined, p: FilingPeriod): boolean {
  if (!stamp || typeof stamp.toMillis !== "function") return false;
  const ms = stamp.toMillis();
  return Number.isFinite(ms) && ms >= p.startMs && ms < p.endMs;
}

/** Tax charged and collected in each period. Estimates, drafts and void invoices never count. */
export function taxByPeriod(invoices: readonly TaxInvoice[], periods: readonly FilingPeriod[]): PeriodTax[] {
  const real = invoices.filter(
    (doc) => doc.kind === "invoice" && doc.status !== "draft" && doc.status !== "void",
  );
  return periods.map((period) => {
    let charged = 0;
    let collected = 0;
    let invoiceCount = 0;
    for (const inv of real) {
      const tax = usable(inv.taxAmount);
      if (tax === 0) continue;
      if (within(inv.issuedAt, period)) {
        charged += tax;
        invoiceCount += 1;
      }
      const total = usable(inv.total);
      if (total === 0) continue;
      // Each payment carries tax in proportion — $53 of a $106 invoice with
      // $6 tax brings in $3 of it — oldest payment first, and never more tax
      // in all than the invoice carried, however much was overpaid.
      const share = tax / total;
      let left = tax;
      const payments = [...(inv.payments ?? [])].sort(
        (a, b) => (a.receivedAt?.toMillis() ?? 0) - (b.receivedAt?.toMillis() ?? 0),
      );
      for (const payment of payments) {
        const part = Math.min(left, usable(payment.amount) * share);
        left -= part;
        if (within(payment.receivedAt, period)) collected += part;
      }
    }
    return { period, charged: round2(charged), collected: round2(collected), invoiceCount };
  });
}
