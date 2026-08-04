"use client";

import { formatMoneyExact } from "@/lib/format";
import { blankLine, draftTotals, toNumber, type Draft, type DraftLine } from "./draft";

const INPUT =
  "w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

/**
 * The line-item table.
 *
 * Money fields use inputMode="decimal" rather than type="number": a number
 * input on iOS still shows the full keyboard on some builds, and its spinners
 * and scroll-to-change behaviour are actively hostile on a phone held in one
 * hand at somebody's front door.
 */
export function LineItemsEditor({
  draft,
  onChange,
  disabled = false,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  disabled?: boolean;
}) {
  const totals = draftTotals(draft);

  function patchLine(id: string, patch: Partial<DraftLine>) {
    onChange({
      ...draft,
      lines: draft.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    });
  }

  function removeLine(id: string) {
    const remaining = draft.lines.filter((line) => line.id !== id);
    // Never leave the editor with nothing to type into.
    onChange({ ...draft, lines: remaining.length > 0 ? remaining : [blankLine()] });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {draft.lines.map((line, index) => {
          const lineTotal = toNumber(line.quantity) * toNumber(line.unitPrice);
          return (
            <li
              key={line.id}
              className="rounded-xl border border-line bg-surface p-3 sm:p-4"
            >
              <div className="flex items-start gap-2">
                <input
                  value={line.description}
                  onChange={(e) => patchLine(line.id, { description: e.target.value })}
                  disabled={disabled}
                  placeholder="What are you doing? e.g. House wash, 2-story"
                  aria-label={`Line ${index + 1} description`}
                  className={INPUT}
                />
                <button
                  type="button"
                  onClick={() => removeLine(line.id)}
                  disabled={disabled}
                  aria-label={`Remove line ${index + 1}`}
                  className="tap-target shrink-0 rounded-lg px-3 text-2xl leading-none text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-40"
                >
                  ×
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-end gap-x-2 gap-y-2">
                <label className="w-20">
                  <span className="mb-1 block text-xs font-bold text-muted">Qty</span>
                  <input
                    value={line.quantity}
                    onChange={(e) => patchLine(line.id, { quantity: e.target.value })}
                    disabled={disabled}
                    inputMode="decimal"
                    className={INPUT}
                  />
                </label>

                <span className="pb-3 text-base font-bold text-muted">×</span>

                <label className="w-28">
                  <span className="mb-1 block text-xs font-bold text-muted">Price</span>
                  <input
                    value={line.unitPrice}
                    onChange={(e) => patchLine(line.id, { unitPrice: e.target.value })}
                    disabled={disabled}
                    inputMode="decimal"
                    placeholder="0.00"
                    className={INPUT}
                  />
                </label>

                <span className="ml-auto pb-2.5 text-lg font-extrabold text-ink tabular-nums">
                  {formatMoneyExact(lineTotal)}
                </span>
              </div>

              <label className="mt-2 flex items-center gap-2 text-sm font-semibold text-muted">
                <input
                  type="checkbox"
                  checked={line.taxable}
                  onChange={(e) => patchLine(line.id, { taxable: e.target.checked })}
                  disabled={disabled}
                  className="size-5 accent-[var(--color-accent)]"
                />
                Taxable
              </label>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => onChange({ ...draft, lines: [...draft.lines, blankLine()] })}
        disabled={disabled}
        className="tap-target w-full rounded-xl border border-dashed border-line bg-surface-2/50 px-4 py-3 text-base font-bold text-accent hover:bg-surface-2 disabled:opacity-40"
      >
        + Add line
      </button>

      <div className="rounded-xl border border-line bg-surface p-3 sm:p-4">
        <TotalRow label="Subtotal" value={formatMoneyExact(totals.subtotal)} />

        <div className="mt-2 flex items-center justify-between gap-3">
          <label className="text-base font-semibold text-muted" htmlFor="gb-discount">
            Discount
          </label>
          <div className="flex items-center gap-1">
            <span className="text-base font-semibold text-muted">−$</span>
            <input
              id="gb-discount"
              value={draft.discount}
              onChange={(e) => onChange({ ...draft, discount: e.target.value })}
              disabled={disabled}
              inputMode="decimal"
              placeholder="0.00"
              className={`${INPUT} w-24 text-right`}
            />
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <label className="text-base font-semibold text-muted" htmlFor="gb-tax">
            Tax
          </label>
          <div className="flex items-center gap-2">
            <input
              id="gb-tax"
              value={draft.taxRatePct}
              onChange={(e) => onChange({ ...draft, taxRatePct: e.target.value })}
              disabled={disabled}
              inputMode="decimal"
              className={`${INPUT} w-16 text-right`}
            />
            <span className="text-base font-semibold text-muted">%</span>
            <span className="w-24 text-right text-base font-bold text-ink tabular-nums">
              {formatMoneyExact(totals.taxAmount)}
            </span>
          </div>
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
          <span className="text-lg font-extrabold text-ink">Total</span>
          <span className="text-2xl font-extrabold text-money tabular-nums">
            {formatMoneyExact(totals.total)}
          </span>
        </div>
      </div>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-base font-semibold text-muted">{label}</span>
      <span className="text-base font-bold text-ink tabular-nums">{value}</span>
    </div>
  );
}
