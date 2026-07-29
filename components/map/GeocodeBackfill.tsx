"use client";

import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { setCoordinates } from "@/lib/db/customers";
import { forwardGeocode } from "@/lib/geocode";
import type { Customer } from "@/lib/types";

/** Google allows far more than this; the pause is to be a polite client. */
const DELAY_MS = 120;

interface Progress {
  done: number;
  total: number;
  placed: number;
  failed: string[];
}

/**
 * Places customers that have an address but no coordinates.
 *
 * Records imported from another system arrive with addresses, not lat/lng, so
 * they are invisible on the map — which is the screen this crew works from all
 * day. Rather than geocoding during the import (which would need a separate
 * server-side key, unrestricted by referrer) this runs in the browser using the
 * key the app already has, correctly restricted, and writes the results back.
 *
 * Only offers itself when there is something to do, and only writes the two
 * coordinate fields. A partial run is fine: whatever it placed stays placed,
 * and running it again picks up the rest.
 */
export function GeocodeBackfill({ customers }: { customers: Customer[] }) {
  const geocodingLib = useMapsLibrary("geocoding");
  const { author } = useTeam();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const unplaced = customers.filter(
    (customer) => customer.address.trim() !== "" && customer.lat === 0 && customer.lng === 0,
  );

  const running = progress !== null && progress.done < progress.total;
  const finished = progress !== null && progress.done === progress.total;

  if (dismissed || !geocodingLib || !author) return null;
  if (unplaced.length === 0 && !finished) return null;

  async function run() {
    if (!geocodingLib || !author) return;
    const geocoder = new geocodingLib.Geocoder();
    const state: Progress = { done: 0, total: unplaced.length, placed: 0, failed: [] };
    setProgress({ ...state });

    for (const customer of unplaced) {
      const position = await forwardGeocode(geocoder, customer.address);

      if (position) {
        try {
          await setCoordinates(customer.id, position.lat, position.lng, author);
          state.placed += 1;
        } catch {
          state.failed.push(customerLabel(customer));
        }
      } else {
        state.failed.push(customerLabel(customer));
      }

      state.done += 1;
      setProgress({ ...state, failed: [...state.failed] });
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  return (
    <div className="absolute inset-x-0 top-0 z-10 border-b border-line bg-surface-1/95 px-3 py-2.5 backdrop-blur">
      {progress === null ? (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm font-bold text-ink">
            {unplaced.length} {unplaced.length === 1 ? "customer has" : "customers have"} an
            address but no pin.
          </p>
          <Button onClick={() => void run()}>Place on map</Button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss the geocoding prompt"
            className="tap-target shrink-0 px-2 text-xl leading-none text-muted"
          >
            ×
          </button>
        </div>
      ) : (
        <div>
          <p className="text-sm font-bold text-ink">
            {running
              ? `Placing… ${progress.done} of ${progress.total}`
              : `Placed ${progress.placed} of ${progress.total}.`}
          </p>

          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
          >
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
            />
          </div>

          {finished ? (
            <div className="mt-2 flex items-start gap-3">
              <p className="min-w-0 flex-1 text-sm font-semibold text-muted">
                {progress.failed.length === 0
                  ? "Every address was matched."
                  : `${progress.failed.length} could not be matched — the address is partial or ` +
                    `Google only found the town. Open the record and drop the pin by hand: ` +
                    `${progress.failed.slice(0, 3).join(", ")}` +
                    `${progress.failed.length > 3 ? `, and ${progress.failed.length - 3} more` : ""}.`}
              </p>
              <Button variant="secondary" onClick={() => setDismissed(true)}>
                Done
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function customerLabel(customer: Customer): string {
  const name = `${customer.firstName} ${customer.lastName}`.trim();
  return name || customer.address || "unnamed";
}
