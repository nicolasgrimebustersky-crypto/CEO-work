import {
  computeTotals,
  DEFAULT_TAX_RATE_PCT,
  type BusinessDocument,
  type DocumentKind,
  type LineItem,
  type Totals,
} from "@/lib/documents";
import type { ServiceType } from "@/lib/types";

/**
 * The document as it exists while someone is typing it.
 *
 * Every number is held as a string. That is not laziness — an `<input>` bound
 * to a number cannot hold "1." or "" while you are part way through typing,
 * so a numeric field either fights the keyboard or silently becomes 0 the
 * moment you clear it to retype. Strings go in, numbers come out at the edges.
 */
export interface DraftLine {
  id: string;
  name: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxable: boolean;
  /** Held as a string for the same reason every other number here is. */
  discountPct: string;
}

export interface Draft {
  kind: DocumentKind;
  customerId: string;
  serviceType: ServiceType;
  lines: DraftLine[];
  discount: string;
  taxRatePct: string;
  notes: string;
  /** yyyy-mm-dd, straight from <input type="date">. */
  dueAt: string;
}

/** A blank field, a stray "$" or a half-typed "1." all read as zero. */
export function toNumber(value: string): number {
  const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function newLineId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `li-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function blankLine(): DraftLine {
  return {
    id: newLineId(),
    name: "",
    description: "",
    quantity: "1",
    unitPrice: "",
    taxable: true,
    discountPct: "",
  };
}

export function emptyDraft(kind: DocumentKind, customerId: string): Draft {
  return {
    kind,
    customerId,
    serviceType: "pressure_washing",
    lines: [blankLine()],
    discount: "",
    taxRatePct: String(DEFAULT_TAX_RATE_PCT),
    notes: "",
    dueAt: "",
  };
}

export function draftFrom(document: BusinessDocument): Draft {
  return {
    kind: document.kind,
    customerId: document.customerId,
    serviceType: document.serviceType,
    lines:
      document.lineItems.length > 0
        ? document.lineItems.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            quantity: String(item.quantity),
            unitPrice: String(item.unitPrice),
            taxable: item.taxable,
            discountPct: item.discountPct ? String(item.discountPct) : "",
          }))
        : [blankLine()],
    discount: document.discount > 0 ? String(document.discount) : "",
    taxRatePct: String(document.taxRatePct),
    notes: document.notes,
    dueAt: document.dueAt ? isoDate(document.dueAt.toDate()) : "",
  };
}

/** Local date, not UTC — toISOString() on an evening date lands on tomorrow. */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Midday, so a due date can't slide a day either way across a timezone. */
export function parseDueDate(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function lineItemsFrom(draft: Draft): LineItem[] {
  return draft.lines
    .filter(
      (line) =>
        line.name.trim() !== "" ||
        line.description.trim() !== "" ||
        toNumber(line.unitPrice) !== 0,
    )
    .map((line) => ({
      id: line.id,
      name: line.name.trim(),
      description: line.description.trim(),
      quantity: toNumber(line.quantity),
      unitPrice: toNumber(line.unitPrice),
      taxable: line.taxable,
      discountPct: toNumber(line.discountPct),
    }));
}

export function draftTotals(draft: Draft): Totals {
  return computeTotals(
    lineItemsFrom(draft),
    toNumber(draft.discount),
    toNumber(draft.taxRatePct),
  );
}

/**
 * Why a draft cannot be saved yet, or null if it can. Returning the reason
 * rather than a boolean means the button can say what is missing instead of
 * sitting greyed out with no explanation.
 */
export function draftProblem(draft: Draft): string | null {
  if (!draft.customerId) return "Pick a customer first.";
  const items = lineItemsFrom(draft);
  if (items.length === 0) return "Add at least one line.";
  if (items.some((item) => item.name === "")) return "Every line needs a service name.";
  if (items.some((item) => item.quantity <= 0)) return "Quantity has to be more than zero.";
  if (items.some((item) => item.unitPrice < 0)) return "A price cannot be negative.";
  return null;
}
