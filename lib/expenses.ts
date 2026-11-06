/**
 * Business expenses: what was spent, on what, and what proves it.
 *
 * The categories follow the expense lines on the IRS Schedule C a sole owner
 * files, named the way a crew talks ("Gas & fuel", not "Car and truck
 * expenses"), so a year's totals hand straight to whoever does the taxes.
 *
 * Proof is the point of the record as much as the amount is. The IRS wants an
 * expense backed by paper: a receipt, or failing that a bank or card statement
 * showing the payment. One confirmed only by the person who paid is still
 * worth writing down, but it is the first thing an audit throws out, so every
 * expense says which of the three it rests on and the totals split by it.
 *
 * "Tax payment" is a category so estimated payments can be logged where the
 * rest of the money out is, but it is not an expense: it is left out of every
 * deductible total and counted against the tax estimate instead.
 *
 * Free of imports so it runs under `node --test` with nothing mocked.
 */

export const EXPENSE_CATEGORIES = [
  "fuel",
  "vehicle",
  "equipment",
  "equipment_repair",
  "tools",
  "supplies",
  "dump_fees",
  "labor",
  "insurance",
  "phone_software",
  "advertising",
  "licenses",
  "meals",
  "other",
  "tax_payment",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  fuel: "Gas & fuel",
  vehicle: "Truck & trailer upkeep",
  equipment: "New equipment",
  equipment_repair: "Equipment repairs",
  tools: "Tools",
  supplies: "Supplies & materials",
  dump_fees: "Dump & disposal fees",
  labor: "Help & subcontractors",
  insurance: "Insurance",
  phone_software: "Phone & software",
  advertising: "Advertising",
  licenses: "Licenses & fees",
  meals: "Meals",
  other: "Other",
  tax_payment: "Tax payment",
};

/** A line under the category chip, so the right one is obvious on a porch. */
export const EXPENSE_CATEGORY_HINT: Record<ExpenseCategory, string> = {
  fuel: "Gas or diesel for the truck, pressure washers and equipment",
  vehicle: "Oil changes, tires, repairs, registration for the truck or trailer",
  equipment: "Bought a pressure washer, surface cleaner, ladder, trailer or other big item",
  equipment_repair: "Pumps, hoses, nozzles, belts, parts and shop repairs on equipment",
  tools: "Hand tools, small power tools, safety gear",
  supplies: "Soap, degreaser, chemicals, squeegees, towels, bags",
  dump_fees: "Landfill, yard-waste and dump-site fees",
  labor: "Paying someone to help, or a subcontractor",
  insurance: "Business liability, equipment or truck insurance",
  phone_software: "Phone bill, apps, website, this CRM",
  advertising: "Flyers, signs, ads, door hangers",
  licenses: "Business licenses, permits, bank and card fees",
  meals: "Meals while working away — only half counts",
  other: "Anything else the business paid for",
  tax_payment: "An estimated tax payment to the IRS or state — not an expense",
};

/** Suggestions for "what was it for", before any history exists to learn from. */
export const COMMON_ASSETS = ["Truck", "Trailer", "Pressure washer", "Surface cleaner", "Ladder", "Water tank"] as const;

export const PAYMENT_METHODS = ["card", "cash", "venmo", "check", "bank", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "Card",
  cash: "Cash",
  venmo: "Venmo",
  check: "Check",
  bank: "Bank transfer",
  other: "Other",
};

/**
 * What the amount rests on, strongest first. A receipt is a photo on the
 * record; a statement means the payment shows on a bank or card statement;
 * in person means only the word of whoever logged it.
 */
export const PROOF_KINDS = ["receipt", "statement", "in_person"] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

export const PROOF_LABEL: Record<ProofKind, string> = {
  receipt: "Receipt on file",
  statement: "On a bank or card statement",
  in_person: "Confirmed in person — no receipt",
};

/** Short form for a badge on a list row. */
export const PROOF_BADGE: Record<ProofKind, string> = {
  receipt: "Receipt",
  statement: "Statement",
  in_person: "No receipt",
};

export interface ReceiptFile {
  url: string;
  /** Storage path, so the file can be removed with the record. */
  path: string;
  contentType: string;
}

export interface ExpenseFields {
  /** The day the money went out, "YYYY-MM-DD". */
  date: string;
  /** Dollars, more than zero. */
  amount: number;
  category: ExpenseCategory;
  /** Where the money went: "Shell on Dixie Hwy", "Home Depot". */
  vendor: string;
  /** What it was for: "Truck", "Pressure washer". Empty when not tied to one. */
  forWhat: string;
  paymentMethod: PaymentMethod;
  proof: ProofKind;
  /** Who confirmed it, or anything else worth knowing. */
  notes: string;
  receipt: ReceiptFile | null;
}

/** How much of an expense counts against profit. Meals are half; tax payments none. */
export const DEDUCTIBLE_SHARE: Record<ExpenseCategory, number> = {
  fuel: 1,
  vehicle: 1,
  equipment: 1,
  equipment_repair: 1,
  tools: 1,
  supplies: 1,
  dump_fees: 1,
  labor: 1,
  insurance: 1,
  phone_software: 1,
  advertising: 1,
  licenses: 1,
  meals: 0.5,
  other: 1,
  tax_payment: 0,
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function isExpenseDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Today in the phone's own calendar, "YYYY-MM-DD" — not UTC, which is tomorrow by 8pm. */
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "12.50", "$12.50", "1,200" → a positive amount in dollars, or null. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 && value < 1_000_000 ? round2(value) : null;
}

/**
 * Whether a form's worth of fields can be saved, and if not, the one thing to
 * fix, in words for the screen. Mirrors validExpense() in firestore.rules.
 */
export function expenseProblem(fields: ExpenseFields): string | null {
  if (!Number.isFinite(fields.amount) || fields.amount <= 0) return "Enter how much it cost.";
  if (fields.amount >= 1_000_000) return "That amount is too large.";
  if (!isExpenseDate(fields.date)) return "Pick the day it was paid.";
  if (!EXPENSE_CATEGORIES.includes(fields.category)) return "Pick what kind of expense it is.";
  if (!PAYMENT_METHODS.includes(fields.paymentMethod)) return "Pick how it was paid.";
  if (!PROOF_KINDS.includes(fields.proof)) return "Say what proves it.";
  if (fields.proof === "receipt" && !fields.receipt) {
    return "Scan the receipt, or choose another way it's confirmed.";
  }
  if (fields.vendor.length > 120 || fields.forWhat.length > 80 || fields.notes.length > 1000) {
    return "One of the text boxes is too long.";
  }
  return null;
}

export interface ExpenseLike {
  date: string;
  amount: number;
  category: ExpenseCategory;
  proof: ProofKind;
  forWhat?: string;
}

export interface ExpenseTotals {
  /** Everything spent on the business, tax payments left out. */
  spent: number;
  /** What counts against profit: meals at half. */
  deductible: number;
  /** Estimated tax already paid. */
  taxPaid: number;
  byCategory: { category: ExpenseCategory; amount: number; count: number }[];
  /** Spending split by what proves it, tax payments left out. */
  byProof: Record<ProofKind, number>;
  count: number;
}

/** Totals for expenses dated in calendar year `year`. */
export function expenseTotals(expenses: readonly ExpenseLike[], year: number): ExpenseTotals {
  const prefix = `${year}-`;
  const byCategory = new Map<ExpenseCategory, { amount: number; count: number }>();
  const byProof: Record<ProofKind, number> = { receipt: 0, statement: 0, in_person: 0 };
  let spent = 0;
  let deductible = 0;
  let taxPaid = 0;
  let count = 0;

  for (const expense of expenses) {
    if (!expense.date.startsWith(prefix)) continue;
    const amount = Number.isFinite(expense.amount) && expense.amount > 0 ? expense.amount : 0;
    if (amount === 0) continue;
    count += 1;
    const entry = byCategory.get(expense.category) ?? { amount: 0, count: 0 };
    entry.amount += amount;
    entry.count += 1;
    byCategory.set(expense.category, entry);

    if (expense.category === "tax_payment") {
      taxPaid += amount;
      continue;
    }
    spent += amount;
    deductible += amount * (DEDUCTIBLE_SHARE[expense.category] ?? 1);
    if (expense.proof in byProof) byProof[expense.proof] += amount;
  }

  return {
    spent: round2(spent),
    deductible: round2(deductible),
    taxPaid: round2(taxPaid),
    byCategory: [...byCategory.entries()]
      .map(([category, entry]) => ({ category, amount: round2(entry.amount), count: entry.count }))
      .sort((a, b) => b.amount - a.amount),
    byProof: {
      receipt: round2(byProof.receipt),
      statement: round2(byProof.statement),
      in_person: round2(byProof.in_person),
    },
    count,
  };
}

/**
 * What the business has spent things "for", most used first: the truck, the
 * pressure washer. Seeds the picker so the same asset is spelled the same way each time.
 */
export function knownAssets(expenses: readonly ExpenseLike[], limit = 8): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const expense of expenses) {
    const name = (expense.forWhat ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const entry = counts.get(key) ?? { name, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  const learned = [...counts.values()].sort((a, b) => b.count - a.count).map((e) => e.name);
  const seen = new Set(learned.map((n) => n.toLowerCase()));
  for (const common of COMMON_ASSETS) {
    if (!seen.has(common.toLowerCase())) learned.push(common);
  }
  return learned.slice(0, limit);
}
