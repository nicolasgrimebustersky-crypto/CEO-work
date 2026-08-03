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

export interface LineItem {
  id: string;
  description: string;
  /** Hours, square feet, or just 1 for a flat price. */
  quantity: number;
  unitPrice: number;
  /** Sales tax does not apply to every line — labour often is not taxed. */
  taxable: boolean;
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

export function lineTotal(item: LineItem): number {
  return round2(item.quantity * item.unitPrice);
}

export interface Totals {
  subtotal: number;
  taxableBase: number;
  discount: number;
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
  const subtotal = round2(lineItems.reduce((sum, item) => sum + lineTotal(item), 0));
  const taxableGross = round2(
    lineItems.filter((item) => item.taxable).reduce((sum, item) => sum + lineTotal(item), 0),
  );

  const appliedDiscount = round2(Math.min(Math.max(discount, 0), subtotal));
  const share = subtotal === 0 ? 0 : taxableGross / subtotal;
  const taxableBase = round2(taxableGross - appliedDiscount * share);

  const taxAmount = round2(taxableBase * (taxRatePct / 100));
  const total = round2(subtotal - appliedDiscount + taxAmount);

  return { subtotal, taxableBase, discount: appliedDiscount, taxAmount, total };
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
  return { id, description: "", quantity: 1, unitPrice: 0, taxable: true };
}
