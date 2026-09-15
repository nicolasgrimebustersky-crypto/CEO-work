/**
 * The Clients list: what each row says beside the name.
 *
 * A row carries three derived things — a colour for the initials disc, how
 * much the client has been invoiced and how much of that is paid, and whether
 * they count as new. None of it is stored; all of it is worked out here from
 * the customer and their documents, so the list, the detail screen and any
 * report that wants the same figure agree by construction.
 *
 * Free of imports so it runs under `node --test` with nothing mocked.
 */

/** The bits of a document this file reads. */
export interface ClientDocument {
  kind: "estimate" | "invoice";
  status: string;
  total: number;
  amountPaid: number;
}

/**
 * Twelve discs, chosen to sit on a near-black canvas with white initials on
 * top of each. Muted rather than saturated on purpose: a list of forty
 * customers in twelve neon colours is a bag of sweets, and the initials are
 * the point, not the disc.
 */
export const AVATAR_COLORS = [
  "#3b6fd6", // blue
  "#8a5a44", // umber
  "#4f7f9a", // steel
  "#9a5a3a", // clay
  "#5b57c9", // indigo
  "#2a9d8f", // teal
  "#4a5563", // slate
  "#7a4f9a", // plum
  "#b0743a", // ochre
  "#2f7a4f", // moss
  "#8f4b62", // wine
  "#3f7a8a", // lagoon
] as const;

/**
 * The same name always gets the same colour, on every phone, with nothing
 * stored. A small hash over the characters; the distribution only has to be
 * good enough that neighbours in an alphabetical list usually differ.
 */
export function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export interface ClientMoney {
  /** Invoices raised, void ones left out. */
  invoiceCount: number;
  /** What those invoices come to. */
  invoiced: number;
  /** What has arrived against them. */
  paid: number;
  /** 0–100, whole number; 0 when nothing has been invoiced. */
  paidPct: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function clientMoney(documents: readonly ClientDocument[]): ClientMoney {
  const invoices = documents.filter((d) => d.kind === "invoice" && d.status !== "void");
  const invoiced = round2(invoices.reduce((sum, d) => sum + d.total, 0));
  const paid = round2(invoices.reduce((sum, d) => sum + Math.min(d.amountPaid, d.total), 0));
  return {
    invoiceCount: invoices.length,
    invoiced,
    paid,
    paidPct: invoiced > 0 ? Math.min(100, Math.round((paid / invoiced) * 100)) : 0,
  };
}

/** How long a client stays "new": a month, with nothing yet invoiced. */
export const NEW_CLIENT_DAYS = 30;

export function isNewClient(
  createdAtMs: number,
  invoiceCount: number,
  nowMs: number = Date.now(),
): boolean {
  if (invoiceCount > 0) return false;
  return nowMs - createdAtMs <= NEW_CLIENT_DAYS * 86_400_000;
}

/** "1 invoice", "2 invoices", "No invoices". */
export function invoiceCountLabel(count: number): string {
  if (count === 0) return "No invoices";
  return count === 1 ? "1 invoice" : `${count} invoices`;
}
