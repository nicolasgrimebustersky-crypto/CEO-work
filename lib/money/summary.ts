/**
 * What actually came in, over a period.
 *
 * The Reports screen sums `job.price` for every completed job, which answers
 * "how much work did we finish" — a different question from "how much money did
 * we take", and the difference is every job that was finished and never paid
 * for. This file answers the second one.
 *
 * Money is counted when it *arrives*, not when the work was done: a job
 * completed in December and paid in January is January's money. That is the
 * convention a bank statement uses, and matching it is the whole point of a
 * figure somebody might put in front of an accountant.
 *
 * Free of imports so the arithmetic — including the double count below, which
 * would silently inflate a year's revenue — is tested by running it.
 */

/** Anything with `toMillis`: Firestore's Timestamp, and the demo store's. */
export interface Stamp {
  toMillis(): number;
}

export interface PaidJob {
  id: string;
  price: number;
  paidAt?: Stamp | null;
}

export interface InvoicePayment {
  amount: number;
  receivedAt?: Stamp | null;
}

export interface InvoiceLike {
  id: string;
  kind: string;
  /** The job this invoice was raised for, when it came from one. */
  jobId?: string | null;
  payments?: readonly InvoicePayment[] | null;
}

export interface Gross {
  /** Cash and cheques recorded straight against a job. */
  fromJobs: number;
  /** Payments recorded against an invoice. */
  fromInvoices: number;
  total: number;
  /** How many of each contributed, as a sanity check on screen. */
  jobCount: number;
  invoiceCount: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function inYear(stamp: Stamp | null | undefined, year: number): boolean {
  if (!stamp || typeof stamp.toMillis !== "function") return false;
  const millis = stamp.toMillis();
  if (!Number.isFinite(millis)) return false;
  return new Date(millis).getFullYear() === year;
}

function usableAmount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Money received in a calendar year, from both places it can land.
 *
 * The trap this exists to avoid: a job can be marked paid *and* have an invoice
 * raised against it that records the same payment. Counting both doubles that
 * job's revenue, and it doubles it silently — the total simply looks like a
 * better year. So any job an invoice points at is dropped from the job side and
 * counted only through the invoice, which is the more detailed record.
 */
export function grossFor(
  year: number,
  jobs: readonly PaidJob[],
  invoices: readonly InvoiceLike[],
): Gross {
  const realInvoices = invoices.filter((doc) => doc.kind === "invoice");

  // Every job already represented by an invoice, paid or not. If the invoice is
  // unpaid the money has not arrived, and counting the job's own `paidAt` would
  // report revenue the invoice itself says is still outstanding.
  const invoiced = new Set<string>();
  for (const invoice of realInvoices) {
    if (typeof invoice.jobId === "string" && invoice.jobId) invoiced.add(invoice.jobId);
  }

  let fromJobs = 0;
  let jobCount = 0;
  for (const job of jobs) {
    if (invoiced.has(job.id)) continue;
    if (!inYear(job.paidAt, year)) continue;
    const amount = usableAmount(job.price);
    if (amount === 0) continue;
    fromJobs += amount;
    jobCount += 1;
  }

  let fromInvoices = 0;
  const paidInvoices = new Set<string>();
  for (const invoice of realInvoices) {
    for (const payment of invoice.payments ?? []) {
      if (!inYear(payment.receivedAt, year)) continue;
      const amount = usableAmount(payment.amount);
      if (amount === 0) continue;
      fromInvoices += amount;
      paidInvoices.add(invoice.id);
    }
  }

  fromJobs = round2(fromJobs);
  fromInvoices = round2(fromInvoices);

  return {
    fromJobs,
    fromInvoices,
    total: round2(fromJobs + fromInvoices),
    jobCount,
    invoiceCount: paidInvoices.size,
  };
}

/**
 * What is still owed: invoiced, and not paid in full.
 *
 * Deliberately not filtered by year — money owed from November is still owed in
 * January, and a figure that forgot it every New Year would be worse than none.
 */
export function outstanding(
  invoices: readonly InvoiceLike[],
  totals: ReadonlyMap<string, number>,
): number {
  let owed = 0;
  for (const invoice of invoices) {
    if (invoice.kind !== "invoice") continue;
    const total = usableAmount(totals.get(invoice.id));
    if (total === 0) continue;
    const paid = (invoice.payments ?? []).reduce(
      (sum, payment) => sum + usableAmount(payment.amount),
      0,
    );
    const left = total - paid;
    // Half a cent of tolerance: floating point should not invent a debt.
    if (left > 0.005) owed += left;
  }
  return round2(owed);
}
