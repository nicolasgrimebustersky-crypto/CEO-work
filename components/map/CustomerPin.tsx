"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";

import { STATUS_COLOR } from "@/lib/status";
import type { Customer } from "@/lib/types";

/**
 * Pins sit on satellite imagery, which is visually noisy and can be any colour.
 * The white outline plus dark drop shadow is what keeps a yellow "quoted" pin
 * legible over a sunlit roof and a black "do not knock" pin legible over asphalt.
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
  const color = STATUS_COLOR[customer.status];

  return (
    <AdvancedMarker
      position={{ lat: customer.lat, lng: customer.lng }}
      title={`${customer.firstName} ${customer.lastName}`.trim() || customer.address}
      zIndex={selected ? 20 : 5}
      onClick={() => onSelect(customer)}
    >
      {/* Padding gives the 44px touch target without inflating the pin art. */}
      <div className="flex size-11 items-end justify-center">
        <svg
          viewBox="0 0 24 32"
          className="h-8 w-6 drop-shadow-[0_2px_3px_rgba(0,0,0,0.85)]"
          aria-hidden="true"
        >
          <path
            d="M12 1c-5.5 0-10 4.3-10 9.7C2 18.2 12 31 12 31s10-12.8 10-20.3C22 5.3 17.5 1 12 1Z"
            fill={color}
            stroke={selected ? "#00d9ff" : "#ffffff"}
            strokeWidth={selected ? 3 : 2}
          />
          <circle cx="12" cy="10.5" r="3.4" fill="#ffffff" opacity={0.92} />
        </svg>
      </div>
    </AdvancedMarker>
  );
}

/** The pin being placed right now — not saved yet, so it reads as provisional. */
export function DraftPin({ position }: { position: google.maps.LatLngLiteral }) {
  return (
    <AdvancedMarker position={position} zIndex={30}>
      <div className="flex size-11 items-end justify-center">
        <svg
          viewBox="0 0 24 32"
          className="h-8 w-6 drop-shadow-[0_2px_3px_rgba(0,0,0,0.85)]"
          aria-hidden="true"
        >
          <path
            d="M12 1c-5.5 0-10 4.3-10 9.7C2 18.2 12 31 12 31s10-12.8 10-20.3C22 5.3 17.5 1 12 1Z"
            fill="#00d9ff"
            stroke="#0b0f14"
            strokeWidth={2}
            strokeDasharray="3 2"
          />
          <circle cx="12" cy="10.5" r="3.4" fill="#0b0f14" />
        </svg>
      </div>
    </AdvancedMarker>
  );
}
