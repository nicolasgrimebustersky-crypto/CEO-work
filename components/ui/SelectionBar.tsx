"use client";

import { Button } from "@/components/ui/Button";
import { allVisibleChosen, selectionLabel } from "@/lib/bulkDelete";

/**
 * The bar that appears along the bottom once a list is in select mode.
 *
 * It sits where the list's own "Create" button normally does, and replaces it
 * rather than stacking above it: a screen offering "Create invoice" and "Delete
 * 6" at the same time, an inch apart, under a thumb, is asking for the wrong
 * one to be hit.
 *
 * Delete is red and disabled at zero. The count is repeated on the button
 * itself, not only in the label above it, because the button is what gets
 * looked at last.
 */
export function SelectionBar({
  selected,
  visible,
  noun,
  onToggleAll,
  onDelete,
  onCancel,
  busy = false,
}: {
  selected: readonly string[];
  /** Ids currently on screen — "select all" means these, not the whole collection. */
  visible: readonly string[];
  /** Singular, e.g. "invoice" — used for the tick-all hint. */
  noun: string;
  onToggleAll: () => void;
  onDelete: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const count = selected.length;
  const everything = allVisibleChosen(selected, visible);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-canvas via-canvas/95 to-transparent px-4 pt-8 pb-3">
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-3xl border border-line bg-surface p-3">
        <div className="flex items-center justify-between gap-3 px-1 pb-3">
          <span className="text-base font-bold text-ink">{selectionLabel(count)}</span>
          <button
            type="button"
            onClick={onToggleAll}
            disabled={busy || visible.length === 0}
            className="tap-target rounded-xl px-2 text-base font-bold text-accent disabled:opacity-50"
          >
            {everything ? "Clear all" : `Select all ${visible.length} ${noun}s`}
          </button>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            full
            onClick={onDelete}
            disabled={busy || count === 0}
          >
            {busy ? "Deleting…" : count === 0 ? "Delete" : `Delete ${count}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The tick on a selectable row.
 *
 * Rendered as a span rather than a real checkbox because the whole row is the
 * control — the row's own button carries the label and the pressed state, and a
 * nested interactive element inside it would be both a second tab stop and a
 * second thing to miss with a thumb.
 */
export function SelectTick({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-6 shrink-0 place-items-center rounded-full border-2 transition ${
        checked ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface-2"
      }`}
    >
      {checked ? (
        <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M4 10.5l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  );
}
