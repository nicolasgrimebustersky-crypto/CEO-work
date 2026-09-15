"use client";

import { Glyph, STATUS_GLYPH } from "@/components/map/pinGlyphs";
import { STATUS_COLOR, STATUS_HINT, STATUS_INK, STATUS_LABEL } from "@/lib/status";
import { CUSTOMER_STATUSES, type CustomerStatus } from "@/lib/types";

/**
 * The status picker: one round badge per status, the same badge the map
 * will draw, with the name underneath. Circles rather than cards because
 * eight cards do not fit on a phone above a form, and eight circles do —
 * two rows of four, or one row on anything wider.
 *
 * One component for every place a status is chosen — dropping a pin,
 * adding a client by hand, the preview on the map, the record, and the map
 * filter — so the pictures and the order never disagree between screens.
 * `selected` is a list so the filter can pick several; the others pass one.
 */
export function StatusPicker({
  selected,
  onSelect,
  disabled = false,
  exclude = [],
  label = "Status",
}: {
  selected: readonly CustomerStatus[];
  onSelect: (status: CustomerStatus) => void;
  disabled?: boolean;
  /** Statuses this picker should not offer (a route never adds a do-not-knock). */
  exclude?: readonly CustomerStatus[];
  label?: string;
}) {
  const options = CUSTOMER_STATUSES.filter((status) => !exclude.includes(status));
  return (
    <div role="group" aria-label={label} className="grid grid-cols-4 gap-x-1 gap-y-3 sm:grid-cols-8">
      {options.map((status) => {
        const active = selected.includes(status);
        const color = STATUS_COLOR[status];
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            title={STATUS_HINT[status]}
            disabled={disabled}
            onClick={() => onSelect(status)}
            className="tap-target flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1 transition disabled:opacity-50"
          >
            <span
              className={`flex size-12 items-center justify-center rounded-full transition-transform ${
                active ? "scale-110 ring-[3px] ring-accent ring-offset-2 ring-offset-surface" : ""
              }`}
              style={{
                backgroundColor: color,
                color: STATUS_INK[status],
                boxShadow:
                  status === "do_not_knock" && !active ? "inset 0 0 0 1.5px #6b7785" : undefined,
              }}
            >
              <Glyph path={STATUS_GLYPH[status]} className="size-6" />
            </span>
            <span
              className={`text-center text-[11px] leading-tight font-bold ${
                active ? "text-ink" : "text-muted"
              }`}
            >
              {STATUS_LABEL[status]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
