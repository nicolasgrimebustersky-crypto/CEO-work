import type { Timestamp } from "firebase/firestore";

import type { ServiceType } from "./types";

/**
 * Estimates and invoices.
 *
 * One shape for both, because in this business they are the same document at
 * two points in its life: you price a job, the customer says yes, and the same
 * lines become the bill. Invoice Fly worked that way and so did Flyra, and
 * splitting them into two models would mean copying line items between them and
 * inventing a way to keep the copies honest.
 *
 * Money is stored in dollars, matching Job.price and Customer.lifetimeValue
 * which already exist. Every derived figure goes through round2() — 0.1 + 0.2
 * is 0.30000000000000004 in IEEE 754, and a total that renders as $1,160.7000001
 * on an invoice destroys trust faster than any missing feature.
 */

export const DOCUMENT_KINDS = ["estimate", "invoice"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * One list, covering both kinds. An estimate is accepted or declined; an
 * invoice is paid or partly paid. `draft` and `sent` are shared, which is what
 * makes converting one to the other a state change rather than a migration.
 */
export const DOCUMENT_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "partial",
  "paid",
  "void",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  partial: "Part paid",
  paid: "Paid",
  void: "Void",
};

/** Which statuses each kind can actually be in, for the status picker. */
export const STATUSES_FOR: Record<DocumentKind, DocumentStatus[]> = {
  estimate: ["draft", "sent", "accepted", "declined", "void"],
  invoice: ["draft", "sent", "partial", "paid", "void"],
};

/** Kentucky state sales tax, and what every imported Flyra estimate used. */
export const DEFAULT_TAX_RATE_PCT = 6;

/**
 * How long a converted invoice gets before it is due.
 *
 * An invoice with no due date can never be late, which means the Money screen
 * can never tell you what to chase — so a converted one gets a date rather than
 * nothing. Two weeks is the ordinary trade term and it is editable on the
 * invoice, which is the point: a default you can change beats a blank you have
 * to fill in every time.
 */
export const INVOICE_TERMS_DAYS = 14;

/** The due date a converted invoice starts with, counted from today. */
export function defaultInvoiceDueDate(from: Date = new Date()): Date {
  const due = new Date(from);
  due.setDate(due.getDate() + INVOICE_TERMS_DAYS);
  // Midday, so a daylight-saving shift can't roll it onto the previous date.
  due.setHours(12, 0, 0, 0);
  return due;
}

export interface LineItem {
  id: string;
  /** What the service is called: "House wash", "Spring cleanup". */
  name: string;
  /**
   * What it actually covers, in the customer's words. This is the line that
   * stops the argument three weeks later about whether the quote included the
   * back patio, so it prints under the name rather than being an internal note.
   */
  description: string;
  /** Hours, square feet, or just 1 for a flat price. */
  quantity: number;
  unitPrice: number;
  /** Sales tax does not apply to every line — labour often is not taxed. */
  taxable: boolean;
  /**
   * A discount on this line alone, 0–100.
   *
   * Per line rather than per document because that is how a real concession is
   * given: ten percent off the labour because the customer supplied the
   * sealant, with the materials untouched. A single document-level figure
   * cannot express that — it comes off everything, including the things you
   * did not mean to discount.
   *
   * Absent on every document written before this existed, which is why every
   * read goes through `lineDiscountPct` rather than touching the field.
   */
  discountPct?: number;
}

export interface Payment {
  id: string;
  amount: number;
  receivedAt: Timestamp;
  /** "Card", "Check 1042", "Cash", "Zelle" — free text, matching how it arrives. */
  method: string;
  recordedBy: string;
  recordedByName: string;
}

export interface BusinessDocument {
  id: string;
  /** Human-facing number, continuing the Invoice Fly sequence. */
  number: string;
  kind: DocumentKind;
  status: DocumentStatus;

  customerId: string;
  /** Denormalised so a list of invoices does not need 50 customer reads. */
  customerName: string;

  serviceType: ServiceType;
  lineItems: LineItem[];

  /** Flat amount off, not a percentage — that is how it was always quoted. */
  discount: number;
  taxRatePct: number;

  /**
   * Totals are stored, not only computed. An invoice sent last March has to
   * keep showing the numbers it showed then, even if a tax rate changes.
   */
  subtotal: number;
  taxAmount: number;
  total: number;

  payments: Payment[];
  amountPaid: number;
  balanceDue: number;

  notes: string;
  issuedAt: Timestamp;
  dueAt: Timestamp | null;
  sentAt: Timestamp | null;
  settledAt: Timestamp | null;

  /** Set on an invoice created from an estimate, so the trail is not lost. */
  convertedFromId: string | null;

  /**
   * Set on an estimate once it has been turned into an invoice.
   *
   * The other half of `convertedFromId`, and the thing that stops the same
   * estimate being billed twice. Without it the convert button stays live
   * forever, and tapping it again — a week later, having forgotten — quietly
   * issues a second invoice for the same work under a second number.
   */
  convertedToId: string | null;

  /**
   * The job this estimate was scheduled as, once somebody put it on the
   * calendar. Same shape and same reasoning as `convertedToId`: it is what
   * turns the button into a link and what stops one accepted estimate becoming
   * two jobs on two different days.
   */
  scheduledJobId: string | null;

  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  updatedAt: Timestamp | null;
  updatedBy: string | null;
  updatedByName: string | null;
}

/** Money rounded to cents. Every total in the app goes through this. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The line before any discount — what the customer is told the work is worth.
 *
 * Kept separate from the net so the printed document can show both: crossing
 * out a real price and showing a lower one is the whole point of giving a
 * discount, and a line that silently prints its net price gives away money
 * without the customer ever noticing they were given anything.
 */
export function lineGross(item: LineItem): number {
  return round2(item.quantity * item.unitPrice);
}

/**
 * This line's discount percentage, clamped and defaulted.
 *
 * Anything outside 0–100 is nonsense: a negative would be a surcharge dressed
 * as a discount, and over 100 would pay the customer to take the work.
 */
export function lineDiscountPct(item: LineItem): number {
  const pct = item.discountPct;
  if (typeof pct !== "number" || !Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

/** What this line's discount is worth in money. */
export function lineDiscount(item: LineItem): number {
  return round2(lineGross(item) * (lineDiscountPct(item) / 100));
}

/** What this line actually adds to the bill. */
export function lineTotal(item: LineItem): number {
  return round2(lineGross(item) - lineDiscount(item));
}

export interface Totals {
  /** Every line at full price, before any discount. */
  subtotal: number;
  /** What the per-line percentages came to. */
  lineDiscounts: number;
  taxableBase: number;
  /** The document-level flat discount, after clamping. */
  discount: number;
  /** Line discounts and the document one together — what the customer saved. */
  totalSaved: number;
  taxAmount: number;
  total: number;
}

/**
 * The one place totals are worked out.
 *
 * The discount comes off before tax, and is spread across taxable and
 * non-taxable lines in proportion — taking it entirely off the taxable portion
 * would understate the tax owed, and entirely off the untaxed portion would
 * overstate it.
 */
export function computeTotals(
  lineItems: LineItem[],
  discount: number,
  taxRatePct: number,
): Totals {
  const subtotal = round2(lineItems.reduce((sum, item) => sum + lineGross(item), 0));
  const lineDiscounts = round2(
    lineItems.reduce((sum, item) => sum + lineDiscount(item), 0),
  );

  const taxable = lineItems.filter((item) => item.taxable);
  const taxableGross = round2(taxable.reduce((sum, item) => sum + lineGross(item), 0));
  const taxableLineDiscounts = round2(
    taxable.reduce((sum, item) => sum + lineDiscount(item), 0),
  );

  // Line discounts come off their own line's taxable base exactly, not by
  // apportionment — the money is known to belong to that line, so guessing
  // would be strictly worse than the arithmetic we already have.
  const netSubtotal = round2(subtotal - lineDiscounts);
  const netTaxable = round2(taxableGross - taxableLineDiscounts);

  // The document-level figure is still a flat amount spread across taxable and
  // untaxed lines in proportion, and it can only discount what is left after
  // the per-line ones.
  const appliedDiscount = round2(Math.min(Math.max(discount, 0), netSubtotal));
  const share = netSubtotal === 0 ? 0 : netTaxable / netSubtotal;
  const taxableBase = round2(Math.max(0, netTaxable - appliedDiscount * share));

  const taxAmount = round2(taxableBase * (taxRatePct / 100));
  const total = round2(netSubtotal - appliedDiscount + taxAmount);

  return {
    subtotal,
    lineDiscounts,
    taxableBase,
    discount: appliedDiscount,
    totalSaved: round2(lineDiscounts + appliedDiscount),
    taxAmount,
    total,
  };
}

export function sumPayments(payments: Payment[]): number {
  return round2(payments.reduce((sum, payment) => sum + payment.amount, 0));
}

/**
 * What the status becomes once money moves. Only invoices are driven by
 * payment; an estimate is accepted by a person saying yes, not by a deposit.
 */
export function statusAfterPayment(
  current: DocumentStatus,
  total: number,
  amountPaid: number,
): DocumentStatus {
  if (current === "void") return "void";
  if (amountPaid <= 0) return current === "paid" || current === "partial" ? "sent" : current;
  // A cent of tolerance: a customer who rounds up should still read as paid.
  if (amountPaid >= total - 0.005) return "paid";
  return "partial";
}

export const OPEN_INVOICE_STATUSES: DocumentStatus[] = ["sent", "partial"];
export const OPEN_ESTIMATE_STATUSES: DocumentStatus[] = ["draft", "sent"];

export function isOutstanding(doc: BusinessDocument): boolean {
  return doc.kind === "invoice" && OPEN_INVOICE_STATUSES.includes(doc.status) && doc.balanceDue > 0;
}

/**
 * Next number in the sequence.
 *
 * Invoice Fly left off at 8903, so the first document raised here is 8904 and
 * the books read continuously across the migration. Estimates and invoices
 * share one sequence, which is what Invoice Fly did — two sequences means two
 * documents can both be "number 12".
 */
export const NUMBER_SEQUENCE_START = 8904;

export function nextNumber(existing: string[]): string {
  const highest = existing.reduce((max, value) => {
    const digits = Number.parseInt(String(value).replace(/\D/g, ""), 10);
    return Number.isFinite(digits) && digits > max ? digits : max;
  }, NUMBER_SEQUENCE_START - 1);

  return String(highest + 1);
}

export function blankLineItem(id: string): LineItem {
  return {
    id,
    name: "",
    description: "",
    quantity: 1,
    unitPrice: 0,
    taxable: true,
    discountPct: 0,
  };
}

/** What the line is called, falling back to its detail if it was never named. */
export function lineLabel(item: LineItem): string {
  return item.name.trim() || item.description.trim() || "Service";
}
