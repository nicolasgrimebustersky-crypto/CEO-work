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

/**
 * What the imports left on the customer record itself.
 *
 * The Flyra and Invoice Fly histories were not modelled as documents; each
 * import folded them into two numbers on the customer — `lifetimeValue` for
 * what was paid, and `pipelineValue` for what was still owed, with the
 * record parked in `awaiting_payment` — and wrote the invoice list into a
 * timeline note. So a client's lifetime figures are those two numbers plus
 * whatever has been raised in the app since. Nothing here is double counted:
 * the app never adds to `lifetimeValue`, so it is only ever history.
 */
export interface ClientHistory {
  lifetimeValue: number;
  pipelineStage: string;
  pipelineValue: number;
  notes?: readonly { text: string }[];
}

/**
 * The outstanding balance the imports recorded, when it is not already
 * represented by an open invoice in the app. A record parked in
 * awaiting_payment by hand *with* an open invoice is the same debt twice, so
 * the invoice wins and the pipeline figure is left out.
 */
export function legacyOwed(history: ClientHistory, openInvoiceBalance: number): number {
  if (history.pipelineStage !== "awaiting_payment") return 0;
  if (openInvoiceBalance > 0) return 0;
  const owed = history.pipelineValue;
  return typeof owed === "number" && Number.isFinite(owed) && owed > 0 ? owed : 0;
}

/**
 * How many invoices the imports recorded, read back out of the note each one
 * left. Both formats are this repository's own scripts', so the text is
 * stable: "(3 invoices, $…" from the Invoice Fly import and "2 invoice(s)."
 * from the Flyra one. Anything else counts as none.
 */
export function importedInvoiceCount(notes: readonly { text: string }[] | undefined): number {
  let count = 0;
  for (const note of notes ?? []) {
    const legacy = /^Legacy invoice history imported .*?\((\d+) invoice/.exec(note.text);
    if (legacy) count += Number(legacy[1]);
    const flyra = /^Imported from Flyra .*?(\d+) invoice\(s\)/.exec(note.text);
    if (flyra) count += Number(flyra[1]);
  }
  return count;
}

export interface ClientMoney {
  /** Invoices raised in the app plus the ones the imports recorded, void ones left out. */
  invoiceCount: number;
  /** Everything ever billed: history paid, history still owed, and the app's invoices. */
  invoiced: number;
  /** Everything that has arrived, history included. */
  paid: number;
  /** 0–100, whole number; 0 when nothing has been invoiced. */
  paidPct: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function clientMoney(
  documents: readonly ClientDocument[],
  history?: ClientHistory,
): ClientMoney {
  const invoices = documents.filter((d) => d.kind === "invoice" && d.status !== "void");
  const appInvoiced = invoices.reduce((sum, d) => sum + d.total, 0);
  const appPaid = invoices.reduce((sum, d) => sum + Math.min(d.amountPaid, d.total), 0);

  const historyPaid =
    history && Number.isFinite(history.lifetimeValue) ? Math.max(0, history.lifetimeValue) : 0;
  const historyOwed = history ? legacyOwed(history, round2(appInvoiced - appPaid)) : 0;

  const invoiced = round2(appInvoiced + historyPaid + historyOwed);
  const paid = round2(appPaid + historyPaid);
  return {
    invoiceCount: invoices.length + importedInvoiceCount(history?.notes),
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
