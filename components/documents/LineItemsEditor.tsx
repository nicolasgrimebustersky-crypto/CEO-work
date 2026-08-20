"use client";

import { useState } from "react";

import type { SavedService } from "@/lib/db/services";
import { formatMoneyExact } from "@/lib/format";
import { ServicePickerSheet } from "./ServicePickerSheet";
import { blankLine, draftTotals, toNumber, type Draft, type DraftLine } from "./draft";

const INPUT =
  "w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

/**
 * The line-item table.
 *
 * Each line is a service with a name and a description, because those do
 * different jobs: the name is what shows in a list and what the price book is
 * keyed on, the description is the sentence that settles what was included
 * when the customer rings up three weeks later. Both print.
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
  // Which line the picker is filling, or null when it is closed.
  const [pickingFor, setPickingFor] = useState<string | null>(null);

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

  /**
   * Fills a line from the price book. The saved price is a starting point, not
   * a rule — every driveway is a different size — so it lands in the editable
   * field rather than being locked.
   */
  function applyService(lineId: string, service: SavedService) {
    patchLine(lineId, {
      name: service.name,
      description: service.description,
      unitPrice: String(service.unitPrice),
      taxable: service.taxable,
    });
    setPickingFor(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {draft.lines.map((line, index) => {
          const gross = toNumber(line.quantity) * toNumber(line.unitPrice);
          const pct = Math.min(100, Math.max(0, toNumber(line.discountPct)));
          const saved = Math.round(gross * (pct / 100) * 100) / 100;
          const lineTotal = Math.round((gross - saved) * 100) / 100;
          const discounted = pct > 0 && saved > 0;
          return (
            <li key={line.id} className="rounded-3xl border border-line bg-surface p-3 sm:p-4">
              <div className="flex items-start gap-2">
                <input
                  value={line.name}
                  onChange={(e) => patchLine(line.id, { name: e.target.value })}
                  disabled={disabled}
                  placeholder="Service — e.g. House wash"
                  aria-label={`Line ${index + 1} service`}
                  className={`${INPUT} font-semibold`}
                />
                <button
                  type="button"
                  onClick={() => removeLine(line.id)}
                  disabled={disabled}
                  aria-label={`Remove line ${index + 1}`}
                  className="tap-target shrink-0 rounded-xl px-3 text-2xl leading-none text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-40"
                >
                  ×
                </button>
              </div>

              <textarea
                value={line.description}
                onChange={(e) => patchLine(line.id, { description: e.target.value })}
                disabled={disabled}
                rows={2}
                placeholder="What it covers — the customer reads this"
                aria-label={`Line ${index + 1} description`}
                className={`${INPUT} mt-2 resize-y`}
              />

              <button
                type="button"
                onClick={() => setPickingFor(line.id)}
                disabled={disabled}
                className="tap-target mt-1 text-sm font-bold text-accent disabled:opacity-40"
              >
                Use a saved service
              </button>

              <div className="mt-1 flex flex-wrap items-end gap-x-2 gap-y-2">
                <label className="w-20">
                  <span className="mb-1 block text-xs font-bold text-muted">Qty</span>
                  <input
                    value={line.quantity}
                    onChange={(e) => patchLine(line.id, { quantity: e.target.value })}
                    disabled={disabled}
                    inputMode="decimal"
                    aria-label={`Line ${index + 1} quantity`}
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
                    aria-label={`Line ${index + 1} price`}
                    className={INPUT}
                  />
                </label>

                <label className="w-24">
                  <span className="mb-1 block text-xs font-bold text-muted">Off %</span>
                  <input
                    value={line.discountPct}
                    onChange={(e) => patchLine(line.id, { discountPct: e.target.value })}
                    disabled={disabled}
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`Line ${index + 1} discount percent`}
                    className={`${INPUT} ${discounted ? "border-money text-money" : ""}`}
                  />
                </label>

                {/* The full price is struck through rather than replaced. A
                    discount nobody sees is money given away for nothing — the
                    customer has to be able to tell they were given something. */}
                <span className="ml-auto flex flex-col items-end pb-2.5">
                  {discounted ? (
                    <span className="text-sm font-bold text-muted line-through tabular-nums">
                      {formatMoneyExact(gross)}
                    </span>
                  ) : null}
                  <span
                    className={`text-lg font-extrabold tabular-nums ${
                      discounted ? "text-money" : "text-ink"
                    }`}
                  >
                    {formatMoneyExact(lineTotal)}
                  </span>
                </span>
              </div>

              {discounted ? (
                <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-money/50 bg-money/10 px-2.5 py-1.5 text-sm font-bold text-money">
                  <span aria-hidden="true">🏷</span>
                  {pct}% off — saves {formatMoneyExact(saved)} on this line
                </p>
              ) : null}

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
        className="tap-target w-full rounded-2xl border border-dashed border-line bg-surface-2/50 px-4 py-3 text-base font-bold text-accent hover:bg-surface-2 disabled:opacity-40"
      >
        + Add line
      </button>

      <div className="rounded-3xl border border-line bg-surface p-3 sm:p-4">
        <TotalRow label="Subtotal" value={formatMoneyExact(totals.subtotal)} />

        {/* Named line by line rather than as one lump. "Discounts −$340" invites
            the question "off what?", and the answer being right there is the
            difference between a concession that lands and one that is argued
            about on the phone a week later. */}
        {totals.lineDiscounts > 0 ? (
          <div className="mt-2 rounded-2xl border border-money/50 bg-money/10 p-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-base font-extrabold text-money">
                Line discounts
              </span>
              <span className="text-base font-extrabold text-money tabular-nums">
                −{formatMoneyExact(totals.lineDiscounts)}
              </span>
            </div>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {draft.lines.map((line, index) => {
                const gross = toNumber(line.quantity) * toNumber(line.unitPrice);
                const pct = Math.min(100, Math.max(0, toNumber(line.discountPct)));
                const saved = Math.round(gross * (pct / 100) * 100) / 100;
                if (saved <= 0) return null;
                return (
                  <li
                    key={line.id}
                    className="flex items-center justify-between gap-3 text-sm font-semibold text-money/90"
                  >
                    <span className="truncate">
                      {line.name.trim() || line.description.trim() || `Line ${index + 1}`} ·{" "}
                      {pct}% off
                    </span>
                    <span className="shrink-0 tabular-nums">
                      −{formatMoneyExact(saved)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

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

        {totals.totalSaved > 0 ? (
          <p
            role="status"
            className="mt-2 rounded-xl bg-money px-3 py-2 text-center text-base font-extrabold text-black"
          >
            They save {formatMoneyExact(totals.totalSaved)}
          </p>
        ) : null}
      </div>

      <ServicePickerSheet
        open={pickingFor !== null}
        onClose={() => setPickingFor(null)}
        onPick={(service) => {
          if (pickingFor) applyService(pickingFor, service);
        }}
      />
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
