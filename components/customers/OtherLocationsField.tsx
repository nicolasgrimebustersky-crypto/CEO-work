"use client";

import { Button } from "@/components/ui/Button";
import type { CustomerLocation } from "@/lib/types";

/**
 * The other sites of a commercial customer: add, edit, remove.
 *
 * Shared by both ways into the book — the drop-a-pin sheet's follow-up edit and
 * the add-by-hand sheet — because a company typed in at a desk and a company
 * pinned on a driveway have to end up as the same record. Purely a field: it
 * holds no state and does no geocoding, so each sheet can place the addresses
 * whichever way suits it.
 *
 * `blank` is what an added row starts as. 0,0 is what lib/maps.ts reads as "no
 * fix", so a row is navigable by its written address from the moment it has
 * one, and the map's backfill can place it properly later.
 */
export const blankLocation: CustomerLocation = { address: "", lat: 0, lng: 0 };

export function OtherLocationsField({
  sites,
  onChange,
  disabled = false,
  hint,
}: {
  sites: CustomerLocation[];
  onChange: (next: CustomerLocation[]) => void;
  disabled?: boolean;
  /** One line under the list, for whatever this sheet has to explain. */
  hint?: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-muted">
        Other locations{sites.length > 0 ? ` (${sites.length})` : ""}
      </p>

      {sites.length === 0 ? (
        <p className="mb-2 text-sm font-medium text-muted">
          One site so far. Add the rest of their properties here.
        </p>
      ) : (
        <ul className="mb-2 flex flex-col gap-2">
          {sites.map((site, index) => (
            <li key={index} className="flex items-center gap-2">
              <input
                value={site.address}
                // A retyped address is a different place, so the old fix goes
                // with it and the row is placed again.
                onChange={(e) =>
                  onChange(
                    sites.map((s, i) =>
                      i === index ? { address: e.target.value, lat: 0, lng: 0 } : s,
                    ),
                  )
                }
                disabled={disabled}
                placeholder="Street address"
                aria-label={`Location ${index + 2}`}
                className="tap-target min-w-0 flex-1 rounded-2xl border border-line bg-surface-2 px-3 text-base font-semibold text-ink placeholder:font-medium placeholder:text-muted/80 focus:border-accent focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(sites.filter((_, i) => i !== index))}
                aria-label={`Remove location ${index + 2}`}
                className="tap-target shrink-0 rounded-2xl border border-line bg-surface-2 px-3 text-sm font-bold text-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="secondary"
        full
        disabled={disabled}
        onClick={() => onChange([...sites, blankLocation])}
      >
        Add another location
      </Button>

      {hint ? <p className="mt-1.5 text-sm font-semibold text-muted">{hint}</p> : null}
    </div>
  );
}
