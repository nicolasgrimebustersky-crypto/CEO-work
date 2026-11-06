/**
 * The payments dashboard: what came in, how, and what is still out.
 *
 * Four figures across the top — collected, share of finished jobs still
 * unpaid, the unpaid balance with its oldest debt, and the average payment —
 * then money by day and a split by payment method. The layout is the one the
 * owner pointed at in another field-service app; the arithmetic follows the
 * rules already settled in ./summary.ts:
 *
 *   - money counts when it arrives, not when the work was done;
 *   - a job an invoice points at is counted through the invoice only, so one
 *     payment is never counted twice;
 *   - nonsense amounts and broken timestamps are ignored, never added.
 *
 * Import-free, so every rule is tested by calling it.
 */

export interface Stamp {
  toMillis(): number;
}

export interface DashJob {
  id: string;
  price: number;
  status: string;
  /** "service" or absent is billable; estimate visits and the like are not. */
  visitType?: string | null;
  paidAt?: Stamp | null;
  completedAt?: Stamp | null;
}

export interface DashPayment {
  amount: number;
  receivedAt?: Stamp | null;
  method?: string | null;
  provider?: string | null;
}

export interface DashInvoice {
  id: string;
  kind: string;
  status: string;
  jobId?: string | null;
  balanceDue?: number | null;
  issuedAt?: Stamp | null;
  payments?: readonly DashPayment[] | null;
}

export const METHODS = ["Card", "Check", "Cash", "Zelle", "Venmo", "Paid on the job", "Other"] as const;
export type Method = (typeof METHODS)[number];

export interface PaymentEvent {
  amount: number;
  at: number;
  method: Method;
}

export interface Range {
  startMs: number;
  /** Exclusive. */
  endMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function millis(stamp: Stamp | null | undefined): number | null {
  if (!stamp || typeof stamp.toMillis !== "function") return null;
  const value = stamp.toMillis();
  return Number.isFinite(value) ? value : null;
}

function usable(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The method as typed — "Check 1042", "cash", "Venmo @jay" — read as one of a
 * few buckets, so the breakdown is five slices rather than fifty.
 */
export function normalizeMethod(raw: string | null | undefined, provider?: string | null): Method {
  if (provider === "stripe") return "Card";
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return "Other";
  if (/\b(card|visa|mastercard|amex|discover|debit|credit|stripe|apple pay|google pay)\b/.test(text)) {
    return "Card";
  }
  if (/\b(check|cheque|chk)\b/.test(text)) return "Check";
  if (/\bcash\b/.test(text)) return "Cash";
  if (/\bzelle\b/.test(text)) return "Zelle";
  if (/\bvenmo\b/.test(text)) return "Venmo";
  return "Other";
}

/** Every payment that has landed, from jobs and invoices, without double counting. */
export function paymentEvents(
  jobs: readonly DashJob[],
  invoices: readonly DashInvoice[],
): PaymentEvent[] {
  const realInvoices = invoices.filter((doc) => doc.kind === "invoice");
  const invoiced = new Set<string>();
  for (const invoice of realInvoices) {
    if (typeof invoice.jobId === "string" && invoice.jobId) invoiced.add(invoice.jobId);
  }

  const events: PaymentEvent[] = [];
  for (const job of jobs) {
    if (invoiced.has(job.id)) continue;
    const at = millis(job.paidAt);
    const amount = usable(job.price);
    if (at === null || amount === 0) continue;
    events.push({ amount, at, method: "Paid on the job" });
  }
  for (const invoice of realInvoices) {
    for (const payment of invoice.payments ?? []) {
      const at = millis(payment.receivedAt);
      const amount = usable(payment.amount);
      if (at === null || amount === 0) continue;
      events.push({ amount, at, method: normalizeMethod(payment.method, payment.provider) });
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

export interface Collected {
  total: number;
  count: number;
  average: number;
}

export function collectedIn(events: readonly PaymentEvent[], range: Range): Collected {
  let total = 0;
  let count = 0;
  for (const event of events) {
    if (event.at < range.startMs || event.at >= range.endMs) continue;
    total += event.amount;
    count += 1;
  }
  total = round2(total);
  return { total, count, average: count === 0 ? 0 : round2(total / count) };
}

export interface Bucket {
  startMs: number;
  total: number;
}

/**
 * Money per day across the range, every day present even when nothing came
 * in, so the chart's gaps are real gaps. A range longer than two months is
 * grouped by week instead, which keeps a year from being 365 spikes.
 *
 * Days are local-time days: a payment at 11pm belongs to the day it was taken
 * on, wherever the server happens to be.
 */
export function byDay(events: readonly PaymentEvent[], range: Range): Bucket[] {
  const long = range.endMs - range.startMs > 62 * DAY_MS;
  const buckets: Bucket[] = [];
  const cursor = new Date(range.startMs);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() < range.endMs) {
    buckets.push({ startMs: cursor.getTime(), total: 0 });
    cursor.setDate(cursor.getDate() + (long ? 7 : 1));
  }
  if (buckets.length === 0) return buckets;

  for (const event of events) {
    if (event.at < range.startMs || event.at >= range.endMs) continue;
    // The last bucket starting at or before the event.
    let low = 0;
    let high = buckets.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (buckets[mid].startMs <= event.at) low = mid;
      else high = mid - 1;
    }
    buckets[low].total += event.amount;
  }
  return buckets.map((bucket) => ({ ...bucket, total: round2(bucket.total) }));
}

export interface MethodShare {
  method: Method;
  total: number;
  /** 0 to 1. */
  share: number;
}

/** Largest first. Methods with nothing are left out. */
export function byMethod(events: readonly PaymentEvent[], range: Range): MethodShare[] {
  const totals = new Map<Method, number>();
  let all = 0;
  for (const event of events) {
    if (event.at < range.startMs || event.at >= range.endMs) continue;
    totals.set(event.method, (totals.get(event.method) ?? 0) + event.amount);
    all += event.amount;
  }
  return [...totals.entries()]
    .map(([method, total]) => ({
      method,
      total: round2(total),
      share: all === 0 ? 0 : total / all,
    }))
    .sort((a, b) => b.total - a.total);
}

export interface Unpaid {
  /** Finished billable jobs in the range that nobody has paid for. */
  unpaidJobs: number;
  finishedJobs: number;
  /** 0 to 1; 0 when nothing was finished. */
  unpaidShare: number;
  /** Everything still owed, whenever it was earned. */
  balance: number;
  /** Age of the oldest unpaid item in whole days, or null when nothing is owed. */
  oldestDays: number | null;
}

/**
 * What is still out.
 *
 * The share is about the range: of the jobs finished in it, how many are
 * unpaid. The balance is not — money owed from last season is still owed — so
 * it covers every open invoice and every finished, uninvoiced, unpaid job.
 */
export function unpaidIn(
  jobs: readonly DashJob[],
  invoices: readonly DashInvoice[],
  range: Range,
  now: number,
): Unpaid {
  const realInvoices = invoices.filter((doc) => doc.kind === "invoice");
  const invoiceForJob = new Map<string, DashInvoice>();
  for (const invoice of realInvoices) {
    if (typeof invoice.jobId === "string" && invoice.jobId) invoiceForJob.set(invoice.jobId, invoice);
  }
  const isOpen = (invoice: DashInvoice) =>
    (invoice.status === "sent" || invoice.status === "partial") && usable(invoice.balanceDue) > 0;

  let finishedJobs = 0;
  let unpaidJobs = 0;
  let balance = 0;
  const oldest = { at: Number.POSITIVE_INFINITY };
  const note = (since: number | null) => {
    if (since !== null && since < oldest.at) oldest.at = since;
  };

  for (const job of jobs) {
    if (job.status !== "complete") continue;
    if (job.visitType && job.visitType !== "service") continue;
    const done = millis(job.completedAt);
    const invoice = invoiceForJob.get(job.id);
    const unpaid = invoice ? isOpen(invoice) : millis(job.paidAt) === null && usable(job.price) > 0;

    if (done !== null && done >= range.startMs && done < range.endMs) {
      finishedJobs += 1;
      if (unpaid) unpaidJobs += 1;
    }
    // An invoiced job's debt is counted through its invoice, below.
    if (!invoice && unpaid) {
      balance += usable(job.price);
      note(done);
    }
  }

  for (const invoice of realInvoices) {
    if (!isOpen(invoice)) continue;
    balance += usable(invoice.balanceDue);
    note(millis(invoice.issuedAt));
  }

  return {
    unpaidJobs,
    finishedJobs,
    unpaidShare: finishedJobs === 0 ? 0 : unpaidJobs / finishedJobs,
    balance: round2(balance),
    oldestDays: Number.isFinite(oldest.at)
      ? Math.max(0, Math.floor((now - oldest.at) / DAY_MS))
      : null,
  };
}
