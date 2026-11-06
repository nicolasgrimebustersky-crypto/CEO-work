/**
 * Which unpaid bill a Venmo payment is for, if that can be known for sure.
 *
 * Two outcomes only: one bill with certainty, or none. A payment applied to
 * the wrong customer is worse than one left for a person to match: it marks
 * somebody paid who is not, and the reminder that would have chased them
 * never goes out. So every rule below demands a single candidate, and
 * anything ambiguous comes back unmatched with the likely candidates listed
 * for the person matching it by hand.
 *
 * The rules, strongest first:
 *   1. The note names an open invoice's number ("8904", "#8904", "inv 8904")
 *      and the amount is no more than that invoice's balance.
 *   2. The payer's name is one customer's name, and exactly one of that
 *      customer's unpaid bills is for exactly this amount.
 *
 * Free of imports so every rule is tested by calling it.
 */

export interface OpenBill {
  kind: "invoice" | "job";
  id: string;
  customerId: string;
  customerName: string;
  /** What is still owed on it, in dollars. */
  owed: number;
  /** Invoice number, for invoices. */
  number?: string;
  /** For a job, the day of the work; for an invoice, when it was raised. Epoch ms. */
  at: number;
}

export interface MatchResult {
  bill: OpenBill | null;
  /** Why it matched, or why not, in words for the screen. */
  reason: string;
  /** Best guesses for a person to pick from when nothing matched. */
  suggestions: OpenBill[];
}

const cents = (value: number) => Math.round(value * 100);

/** "Larry  Lupinski" and "larry lupinski" are the same person; "L. Lupinski" is not. */
export function normalName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every 3-to-8-digit number in the note. Invoice numbers are plain digits. */
function numbersIn(note: string): string[] {
  return [...note.matchAll(/(?<![\d.])(\d{3,8})(?![\d.])/g)].map((m) => m[1]);
}

export function matchVenmoPayment(
  payment: { payerName: string; amount: number; note: string },
  bills: readonly OpenBill[],
): MatchResult {
  const amount = cents(payment.amount);
  const open = bills.filter((bill) => cents(bill.owed) > 0);

  // 1. An invoice number in the note.
  const numbers = new Set(numbersIn(payment.note));
  const byNumber = open.filter(
    (bill) => bill.kind === "invoice" && bill.number && numbers.has(String(bill.number).replace(/\D/g, "")),
  );
  if (byNumber.length === 1) {
    const bill = byNumber[0];
    if (amount <= cents(bill.owed)) {
      return { bill, reason: `Note names invoice ${bill.number}`, suggestions: [] };
    }
    return {
      bill: null,
      reason: `Note names invoice ${bill.number}, but $${payment.amount.toFixed(2)} is more than the $${bill.owed.toFixed(2)} it owes`,
      suggestions: [bill],
    };
  }

  // 2. The payer's name, and exactly one bill of theirs for this amount.
  const payer = normalName(payment.payerName);
  const theirs = open.filter((bill) => normalName(bill.customerName) === payer);
  const customers = new Set(theirs.map((bill) => bill.customerId));
  const sameAmount = (list: readonly OpenBill[]) => list.filter((bill) => cents(bill.owed) === amount);

  if (customers.size === 1) {
    const exact = sameAmount(theirs);
    if (exact.length === 1) {
      return { bill: exact[0], reason: `${payment.payerName} owed exactly this on one bill`, suggestions: [] };
    }
    return {
      bill: null,
      reason:
        exact.length > 1
          ? `${payment.payerName} has ${exact.length} unpaid bills for this amount`
          : `${payment.payerName} has no unpaid bill for exactly $${payment.amount.toFixed(2)}`,
      suggestions: [...exact, ...theirs.filter((b) => !exact.includes(b))].slice(0, 6),
    };
  }

  const reason =
    customers.size > 1
      ? `More than one client is named ${payment.payerName}`
      : `No client named ${payment.payerName} has an unpaid bill`;
  // Nothing by name: the same amount anywhere is the next best guess, newest first.
  const guesses = [...sameAmount(open)].sort((a, b) => b.at - a.at).slice(0, 6);
  return { bill: null, reason, suggestions: customers.size > 1 ? theirs.slice(0, 6) : guesses };
}
