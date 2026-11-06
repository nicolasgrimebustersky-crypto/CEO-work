/**
 * The year-end packet for the accountant: everything a Schedule C needs,
 * from what the app already holds.
 *
 *   - Profit and loss by Schedule C line.
 *   - Every expense, with its proof (receipt / statement / in person).
 *   - The mileage log.
 *   - Sales tax charged, collected and paid to the state.
 *   - Contractor payments, flagged at the 1099-NEC threshold.
 *   - Estimated tax payments made.
 *
 * The line mapping is a starting point for the accountant, not a filing:
 * equipment goes to line 13 because Section 179 or bonus depreciation is
 * their call, and gas and truck upkeep move to line 9 or are replaced by
 * the mileage figure depending on the owner's mileage method.
 *
 * Free of imports so the arithmetic is tested by calling it.
 */

export interface ContractorThreshold {
  /** First calendar year the threshold applies to. */
  year: number;
  dollars: number;
}

/**
 * 1099-NEC filing threshold by year of payment. $600 through 2025; $2,000
 * for payments made in 2026 (One Big Beautiful Bill Act, IRC 6041 as
 * amended), indexed for inflation from 2027 — add a row each year.
 */
export const CONTRACTOR_1099_THRESHOLDS: readonly ContractorThreshold[] = [
  { year: 2020, dollars: 600 },
  { year: 2026, dollars: 2000 },
];

export function contractorThreshold(year: number): number {
  let dollars = CONTRACTOR_1099_THRESHOLDS[0].dollars;
  for (const t of CONTRACTOR_1099_THRESHOLDS) if (t.year <= year) dollars = t.dollars;
  return dollars;
}

export interface PacketExpense {
  id: string;
  date: string;
  amount: number;
  category: string;
  vendor: string;
  forWhat: string;
  paymentMethod: string;
  proof: string;
  notes: string;
  createdByName: string;
  receiptUrl: string | null;
}

export interface PacketTrip {
  date: string;
  miles: number;
  reason: string;
  createdByName: string;
  estimated: boolean;
  /** Standard-rate value of this trip, dollars. */
  value: number;
}

export interface PacketSalesTax {
  charged: number;
  collected: number;
}

export interface PacketInput {
  year: number;
  /** Money received in the year (lib/money/summary grossFor). */
  grossReceipts: number;
  expenses: readonly PacketExpense[];
  trips: readonly PacketTrip[];
  salesTax: PacketSalesTax;
  mileageMethod: "standard" | "actual";
}

export interface ScheduleCLine {
  line: string;
  label: string;
  amount: number;
}

export interface Contractor {
  name: string;
  paid: number;
  payments: number;
  needs1099: boolean;
}

export interface Packet {
  year: number;
  lines: ScheduleCLine[];
  totalExpenses: number;
  netProfit: number;
  expenses: PacketExpense[];
  trips: PacketTrip[];
  miles: number;
  mileageValue: number;
  salesTax: PacketSalesTax & { remitted: number };
  contractors: Contractor[];
  contractorThreshold: number;
  estimatedPayments: PacketExpense[];
  estimatedPaid: number;
  /** Spending with no receipt or statement behind it. */
  paperless: number;
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Which Schedule C line an expense category belongs on. Null: not an expense. */
export function scheduleCLine(category: string, mileageMethod: "standard" | "actual"): string | null {
  switch (category) {
    case "advertising":
      return "8";
    case "fuel":
    case "vehicle":
      // With the standard mileage rate the miles replace these.
      return mileageMethod === "actual" ? "9" : null;
    case "labor":
      return "11";
    case "equipment":
      return "13";
    case "insurance":
      return "15";
    case "equipment_repair":
      return "21";
    case "supplies":
    case "tools":
      return "22";
    case "licenses":
      return "23";
    case "meals":
      return "24b";
    case "phone_software":
    case "dump_fees":
    case "other":
      return "27a";
    default:
      return null; // tax payments and sales tax remitted
  }
}

const LINE_LABEL: Record<string, string> = {
  "1": "Gross receipts",
  "8": "Advertising",
  "9": "Car and truck expenses",
  "11": "Contract labor",
  "13": "Depreciation and Section 179 (equipment bought — accountant decides)",
  "15": "Insurance (other than health)",
  "21": "Repairs and maintenance",
  "22": "Supplies (includes small tools)",
  "23": "Taxes and licenses (includes sales tax paid to Kentucky)",
  "24b": "Deductible meals (50%)",
  "27a": "Other expenses (phone, software, dump fees, other)",
};

const LINE_ORDER = ["8", "9", "11", "13", "15", "21", "22", "23", "24b", "27a"];

export function buildPacket(input: PacketInput): Packet {
  const prefix = `${input.year}-`;
  const expenses = input.expenses
    .filter((e) => e.date.startsWith(prefix) && Number.isFinite(e.amount) && e.amount > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const trips = input.trips
    .filter((t) => t.date.startsWith(prefix) && Number.isFinite(t.miles) && t.miles > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const byLine = new Map<string, number>();
  const add = (line: string, amount: number) => byLine.set(line, (byLine.get(line) ?? 0) + amount);
  let paperless = 0;
  let remitted = 0;
  const estimatedPayments: PacketExpense[] = [];

  for (const e of expenses) {
    if (e.category === "tax_payment") {
      estimatedPayments.push(e);
      continue;
    }
    if (e.category === "sales_tax_remitted") {
      remitted += e.amount;
      continue;
    }
    if (e.proof === "in_person") paperless += e.amount;
    const line = scheduleCLine(e.category, input.mileageMethod);
    if (!line) continue;
    add(line, e.category === "meals" ? e.amount * 0.5 : e.amount);
  }
  const miles = trips.reduce((s, t) => s + t.miles, 0);
  const mileageValue = trips.reduce((s, t) => s + t.value, 0);
  if (input.mileageMethod === "standard" && mileageValue > 0) add("9", mileageValue);
  if (remitted > 0) add("23", remitted);

  const lines: ScheduleCLine[] = [
    { line: "1", label: LINE_LABEL["1"], amount: round2(input.grossReceipts) },
    ...LINE_ORDER.filter((l) => (byLine.get(l) ?? 0) > 0).map((l) => ({
      line: l,
      label: LINE_LABEL[l],
      amount: round2(byLine.get(l) ?? 0),
    })),
  ];
  const totalExpenses = round2(lines.filter((l) => l.line !== "1").reduce((s, l) => s + l.amount, 0));

  // Contractors: help and subcontractor payments, by who was paid.
  const threshold = contractorThreshold(input.year);
  const people = new Map<string, { name: string; paid: number; payments: number }>();
  for (const e of expenses) {
    if (e.category !== "labor") continue;
    const name = e.vendor.trim() || "(no name entered)";
    const key = name.toLowerCase();
    const entry = people.get(key) ?? { name, paid: 0, payments: 0 };
    entry.paid += e.amount;
    entry.payments += 1;
    people.set(key, entry);
  }
  const contractors = [...people.values()]
    .map((c) => ({ ...c, paid: round2(c.paid), needs1099: c.paid >= threshold }))
    .sort((a, b) => b.paid - a.paid);

  return {
    year: input.year,
    lines,
    totalExpenses,
    netProfit: round2(input.grossReceipts - totalExpenses),
    expenses,
    trips,
    miles: round2(miles),
    mileageValue: round2(mileageValue),
    salesTax: { ...input.salesTax, remitted: round2(remitted) },
    contractors,
    contractorThreshold: threshold,
    estimatedPayments,
    estimatedPaid: round2(estimatedPayments.reduce((s, e) => s + e.amount, 0)),
    paperless: round2(paperless),
  };
}

/** A CSV cell: quoted when it holds a comma, quote or newline; formulas defused. */
export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  let s = String(value);
  // A spreadsheet runs a cell starting with = + - @ as a formula; a vendor
  // name must never be able to do that on the accountant's machine.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (cells: (string | number | boolean | null)[]) => cells.map(csvCell).join(",");

/** The whole packet as one CSV, a section per table with a blank line between. */
export function packetCsv(p: Packet, businessName: string): string {
  const out: string[] = [];
  out.push(row([`${businessName} — ${p.year} year-end packet`]));
  out.push("");
  out.push(row(["PROFIT AND LOSS (Schedule C)"]));
  out.push(row(["Line", "Description", "Amount"]));
  for (const l of p.lines) out.push(row([l.line, l.label, l.amount.toFixed(2)]));
  out.push(row(["", "Total expenses", p.totalExpenses.toFixed(2)]));
  out.push(row(["31", "Net profit", p.netProfit.toFixed(2)]));
  out.push("");
  out.push(row(["EXPENSES"]));
  out.push(row(["Date", "Category", "Amount", "Vendor", "For", "Paid with", "Proof", "Logged by", "Notes", "Receipt"]));
  for (const e of p.expenses) {
    out.push(row([e.date, e.category, e.amount.toFixed(2), e.vendor, e.forWhat, e.paymentMethod, e.proof, e.createdByName, e.notes, e.receiptUrl]));
  }
  out.push("");
  out.push(row(["MILEAGE LOG"]));
  out.push(row(["Date", "Miles", "Reason", "Driver", "Estimated", "Value at IRS rate"]));
  for (const t of p.trips) out.push(row([t.date, t.miles, t.reason, t.createdByName, t.estimated, t.value.toFixed(2)]));
  out.push(row(["Total", p.miles, "", "", "", p.mileageValue.toFixed(2)]));
  out.push("");
  out.push(row(["SALES TAX"]));
  out.push(row(["Charged on invoices", p.salesTax.charged.toFixed(2)]));
  out.push(row(["Collected in payments", p.salesTax.collected.toFixed(2)]));
  out.push(row(["Paid to the state", p.salesTax.remitted.toFixed(2)]));
  out.push("");
  out.push(row([`CONTRACTORS (1099-NEC threshold ${p.contractorThreshold})`]));
  out.push(row(["Name", "Paid", "Payments", "Needs 1099-NEC"]));
  for (const c of p.contractors) out.push(row([c.name, c.paid.toFixed(2), c.payments, c.needs1099 ? "yes" : "no"]));
  out.push("");
  out.push(row(["ESTIMATED TAX PAYMENTS"]));
  out.push(row(["Date", "Paid to", "Amount"]));
  for (const e of p.estimatedPayments) out.push(row([e.date, e.vendor, e.amount.toFixed(2)]));
  out.push(row(["Total", "", p.estimatedPaid.toFixed(2)]));
  return out.join("\r\n") + "\r\n";
}
