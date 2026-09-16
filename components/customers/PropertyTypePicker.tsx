"use client";

import { PROPERTY_TYPE_LABEL } from "@/lib/status";
import { PROPERTY_TYPES } from "@/lib/types";
import type { PropertyType } from "@/lib/types";

/**
 * House or business, in two taps' worth of screen.
 *
 * Shared by the drop-a-pin sheet and the edit sheet rather than written twice,
 * because the two have to agree: the same choice on the driveway and back in
 * the truck, or the field means nothing.
 */
export function PropertyTypePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: PropertyType;
  onChange: (next: PropertyType) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      {PROPERTY_TYPES.map((type) => {
        const active = value === type;
        return (
          <button
            key={type}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(type)}
            className={`tap-target flex-1 rounded-2xl border px-4 py-3 text-sm font-bold transition disabled:opacity-50 ${
              active
                ? "border-accent bg-accent/15 text-ink"
                : "border-line bg-surface text-muted hover:bg-surface-2"
            }`}
          >
            {PROPERTY_TYPE_LABEL[type]}
          </button>
        );
      })}
    </div>
  );
}
