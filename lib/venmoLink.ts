/**
 * A link that opens Venmo with the payment filled in: who to pay, how much,
 * and a note naming the invoice.
 *
 * The note is what lets the CRM mark the invoice paid on its own: Venmo's
 * "paid you" email carries the note, and an invoice number in it is the
 * strongest match there is (lib/venmoMatch.ts).
 *
 * `venmo.com/<username>?txn=pay&amount=…&note=…` opens the Venmo app on a
 * phone with those fields set, and Venmo's site on a computer. The customer
 * still confirms the payment in Venmo; nothing is charged by opening it.
 *
 * Free of imports so it is tested by calling it.
 */

/** "@Radams1015", "Radams1015" or "venmo.com/u/Radams1015" → "Radams1015". */
export function venmoUsername(handle: string | null | undefined): string | null {
  const name = String(handle ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?venmo\.com\/(u\/)?/i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9_-]{2,40}$/.test(name) ? name : null;
}

export function venmoPayUrl(
  handle: string | null | undefined,
  amount: number,
  note: string,
): string | null {
  const user = venmoUsername(handle);
  if (!user || !Number.isFinite(amount) || amount <= 0) return null;
  const params = new URLSearchParams({
    txn: "pay",
    amount: amount.toFixed(2),
    note: note.slice(0, 280),
  });
  return `https://venmo.com/${encodeURIComponent(user)}?${params.toString()}`;
}
