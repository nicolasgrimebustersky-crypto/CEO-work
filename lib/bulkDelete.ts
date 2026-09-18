/**
 * Choosing several records and deleting them together.
 *
 * The pure half: which ids are ticked, and what the confirmation is going to
 * say out loud before anything is destroyed. No Firestore, no React, so the
 * sentence a person reads immediately before an irreversible action can be
 * tested directly rather than by clicking through a UI.
 *
 * That sentence is the point of this module. Bulk delete is the one gesture in
 * the app where a slip is unrecoverable and silent — nobody notices four
 * invoices missing until the month does not add up — so the wording has to
 * state the count, the kind, and what is NOT being deleted, in words that mean
 * the same thing to someone reading them at arm's length on a phone.
 */

/** Firestore's hard ceiling on one batched write. */
export const MAX_BATCH = 500;

export function toggleId(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id];
}

/**
 * Tick-all / untick-all for the rows currently on screen.
 *
 * Deliberately scoped to `visible`: when a filter or search is active, "select
 * all" must mean the rows being looked at and not every record behind them.
 * Selecting things you cannot see and then deleting them is precisely the
 * accident this whole module is written to avoid.
 */
export function toggleAll(selected: readonly string[], visible: readonly string[]): string[] {
  const allChosen = visible.length > 0 && visible.every((id) => selected.includes(id));
  if (allChosen) return selected.filter((id) => !visible.includes(id));
  const next = [...selected];
  for (const id of visible) if (!next.includes(id)) next.push(id);
  return next;
}

/** True when every visible row is ticked — drives the tick-all control's state. */
export function allVisibleChosen(
  selected: readonly string[],
  visible: readonly string[],
): boolean {
  return visible.length > 0 && visible.every((id) => selected.includes(id));
}

/** "3 selected", for the bar. Singular when it is one, because "1 selected" reads wrong. */
export function selectionLabel(count: number): string {
  if (count === 0) return "None selected";
  return count === 1 ? "1 selected" : `${count} selected`;
}

export interface ConfirmCopy {
  title: string;
  body: string;
  /** The destructive button. Names the count, so the last thing read is the scale. */
  action: string;
}

/**
 * What the confirmation sheet says.
 *
 * `kind` is the singular noun ("invoice", "estimate", "client"). The plural is
 * formed by adding an s, which is correct for every noun this app uses; it is
 * not a general pluraliser and is not meant to be.
 */
export function confirmCopy(kind: string, count: number): ConfirmCopy {
  const noun = count === 1 ? kind : `${kind}s`;
  return {
    title: count === 1 ? `Delete this ${kind}?` : `Delete ${count} ${noun}?`,
    body:
      count === 1
        ? `This removes it from every phone straight away, and it cannot be undone.`
        : `This removes ${count} ${noun} from every phone straight away, and it cannot be undone.`,
    action: count === 1 ? "Delete" : `Delete ${count}`,
  };
}

/**
 * The extra line shown when deleting clients who still have paperwork.
 *
 * Deleting a client leaves their estimates and invoices in place, on purpose:
 * every document stores the customer's name on itself, so the money history
 * still reads correctly and the dashboard totals do not move. Saying so matters
 * — someone deleting a client to tidy up the map should not be left wondering
 * whether they have just erased a year of revenue.
 *
 * Empty when there is nothing attached, so the sheet does not explain a
 * consequence that is not happening.
 */
export function clientDeleteNote(documentCount: number): string {
  if (documentCount <= 0) return "";
  const noun = documentCount === 1 ? "document" : "documents";
  return (
    `Their ${documentCount} ${noun} stay, so your money history and totals don't change. ` +
    `The paperwork keeps the name that was on it.`
  );
}

/**
 * Splits ids into batch-sized chunks.
 *
 * Firestore refuses a batch over 500 writes. Clearing a season of test data can
 * pass that, and the failure mode without this is the whole delete rejected
 * after the user has already confirmed it — so the work is split and committed
 * in order instead.
 */
export function chunkIds(ids: readonly string[], size: number = MAX_BATCH): string[][] {
  if (size < 1) throw new Error("Chunk size must be at least 1.");
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}
