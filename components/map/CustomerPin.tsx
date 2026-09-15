"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";

import type { Customer } from "@/lib/types";
import { customerPinGlyph, PinMark, PLUS_GLYPH } from "./pinGlyphs";

/**
 * A customer on the map: the status colour, and inside it what they are
 * interested in. See pinGlyphs.tsx for the pictures and the reasoning.
 */
export function CustomerPin({
  customer,
  selected,
  onSelect,
}: {
  customer: Customer;
  selected: boolean;
  onSelect: (customer: Customer) => void;
}) {
  return (
    <AdvancedMarker
      position={{ lat: customer.lat, lng: customer.lng }}
      title={`${customer.firstName} ${customer.lastName}`.trim() || customer.address}
      zIndex={selected ? 20 : 5}
      onClick={() => onSelect(customer)}
    >
      {/* An AdvancedMarker hangs its content above the coordinate; a round
          badge wants to sit *on* it, so the box is pushed down by half its
          height. The box is the 44px touch target; the badge inside it grows
          from its centre when selected, so it never drifts off the house. */}
      <div className="flex size-11 translate-y-1/2 items-center justify-center">
        <div
          className="transition-transform duration-200"
          style={{ transform: selected ? "scale(1.2)" : "scale(1)" }}
        >
          <PinMark
            status={customer.status}
            glyph={customerPinGlyph(customer)}
            selected={selected}
          />
        </div>
      </div>
    </AdvancedMarker>
  );
}

/**
 * The pin being placed right now. Not saved yet, so it reads as provisional:
 * cyan (the tap colour, not a status), a dashed ring, and a drop-in so the
 * eye goes to it.
 */
export function DraftPin({ position }: { position: google.maps.LatLngLiteral }) {
  return (
    <AdvancedMarker position={position} zIndex={30}>
      <div className="flex size-11 translate-y-1/2 items-center justify-center">
        <div style={{ animation: "gb-pin-drop 420ms cubic-bezier(0.2, 0.9, 0.3, 1.2)" }}>
          <PinMark status="draft" glyph={PLUS_GLYPH} draft />
        </div>
      </div>
    </AdvancedMarker>
  );
}
