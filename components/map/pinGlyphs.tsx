"use client";

import { STATUS_COLOR, STATUS_INK } from "@/lib/status";
import type { Customer, CustomerStatus, ServiceType } from "@/lib/types";

/**
 * The pictures on the pins, and the pins themselves.
 *
 * A pin is its status, twice over: the colour is the fixed
 * lead/quoted/customer/no/never palette the whole app shares, and the mark
 * inside says the same thing in a shape — a house, a price tag, a dollar,
 * a no-entry sign, a ban sign. The service glyphs live here too, for the
 * entry form and anywhere else a drop, a leaf or a snowflake is wanted.
 *
 * Every glyph is a path in a 24×24 box so it can be dropped into a pin, a
 * status card or a chip at any size with one transform. Paths only, no
 * strokes that depend on scale.
 */
export const SERVICE_GLYPH: Record<ServiceType, string> = {
  // A drop of water.
  pressure_washing:
    "M12 2.5c-.4 0-.7.2-.9.5C9.3 5.7 5.5 10.4 5.5 14a6.5 6.5 0 0 0 13 0c0-3.6-3.8-8.3-5.6-11a1 1 0 0 0-.9-.5Zm-2.6 11.2a.9.9 0 0 1 .9.9 1.7 1.7 0 0 0 1.7 1.7.9.9 0 0 1 0 1.8 3.5 3.5 0 0 1-3.5-3.5.9.9 0 0 1 .9-.9Z",
  // A leaf.
  landscaping:
    "M20.2 3.8c-.2-.2-.4-.3-.7-.3C11 3.9 5.6 8.1 4.7 14.6c-.2 1.6 0 3 .4 4.2l-1.6 1.6a.9.9 0 1 0 1.3 1.3l1.6-1.6c1.3.5 2.7.7 4.3.5 6.4-.9 10.7-6.3 11.1-14.8a1 1 0 0 0-.3-.7ZM8.9 17.6c-.5.1-1 .1-1.5 0l4.9-4.9a.9.9 0 1 0-1.3-1.3l-4.9 4.9a5.8 5.8 0 0 1 0-1.5c.7-4.7 4.6-8 11.3-8.9-.9 6.6-4 10.9-8.5 11.7Z",
  // A snowflake.
  snow_removal:
    "M12 1.5a1 1 0 0 1 1 1v2.4l1.7-1a1 1 0 1 1 1 1.7L13 7.2v3.1l2.7-1.6.1-3.1a1 1 0 1 1 2 .1l-.1 2 2.1-1.2a1 1 0 1 1 1 1.7L18.7 9.4l1.7 1a1 1 0 1 1-1 1.7l-2.7-1.5L14 12l2.7 1.6 2.7-1.6a1 1 0 1 1 1 1.7l-1.7 1 2.1 1.2a1 1 0 1 1-1 1.7l-2.1-1.2.1 2a1 1 0 1 1-2 .1l-.1-3.1L13 13.7v3.1l2.7 1.6a1 1 0 1 1-1 1.7l-1.7-1v2.4a1 1 0 1 1-2 0v-2.4l-1.7 1a1 1 0 1 1-1-1.7l2.7-1.6v-3.1l-2.7 1.6-.1 3.1a1 1 0 1 1-2-.1l.1-2-2.1 1.2a1 1 0 1 1-1-1.7l1.7-1-2.1-1.2a1 1 0 1 1 1-1.7l2.1 1.2-.1-2a1 1 0 1 1 2-.1l.1 3.1 2.7 1.6L10 12 7.3 10.4l-2.7 1.5a1 1 0 1 1-1-1.7l1.7-1L3.2 8a1 1 0 1 1 1-1.7l2.1 1.2-.1-2a1 1 0 1 1 2-.1l.1 3.1L11 10.3V7.2L8.3 5.6a1 1 0 1 1 1-1.7l1.7 1V2.5a1 1 0 0 1 1-1Z",
};

/** A house: a lead nobody has talked to yet, or one with no service noted. */
export const HOUSE_GLYPH =
  "M12 3.2a1.2 1.2 0 0 0-.8.3l-8 6.9a1 1 0 0 0 1.3 1.5l.5-.4V19a2 2 0 0 0 2 2h4a1 1 0 0 0 1-1v-4h2v4a1 1 0 0 0 1 1h4a2 2 0 0 0 2-2v-7.5l.5.4a1 1 0 0 0 1.3-1.5l-8-6.9a1.2 1.2 0 0 0-.8-.3Z";

/** A no-entry sign: they said no. */
export const NO_GLYPH =
  "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm-5 8.3h10a1.2 1.2 0 0 1 0 2.4H7a1.2 1.2 0 0 1 0-2.4Z";

/** A ban sign: never knock here again. */
export const BAN_GLYPH =
  "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm0 2a7.5 7.5 0 0 1 5.9 12.1L7.4 6.1A7.5 7.5 0 0 1 12 4.5Zm-5.9 2.9 10.5 10.5A7.5 7.5 0 0 1 6.1 7.4Z";

/** A tag with a price on it: quoted. */
export const QUOTE_GLYPH =
  "M3.5 4.5A1 1 0 0 1 4.5 3.5h6.6c.3 0 .5.1.7.3l8.4 8.4a1 1 0 0 1 0 1.4l-6.6 6.6a1 1 0 0 1-1.4 0L3.8 11.8a1 1 0 0 1-.3-.7V4.5Zm4.5 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z";

/** A plus: the pin being placed. */
export const PLUS_GLYPH =
  "M12 4a1.1 1.1 0 0 1 1.1 1.1v5.8h5.8a1.1 1.1 0 1 1 0 2.2h-5.8v5.8a1.1 1.1 0 1 1-2.2 0v-5.8H5.1a1.1 1.1 0 1 1 0-2.2h5.8V5.1A1.1 1.1 0 0 1 12 4Z";

/** A dollar: a paying customer. */
export const DOLLAR_GLYPH =
  "M12 2a1 1 0 0 1 1 1v1.1c2.3.3 4 1.8 4.2 3.9a1 1 0 0 1-2 .2c-.1-1.1-1.1-2-2.7-2.1h-1.1c-1.5 0-2.6.8-2.6 1.9 0 1 .7 1.6 2.5 2l1.5.3c2.9.6 4.3 1.9 4.3 4.1 0 2.2-1.7 3.7-4.1 4v1.6a1 1 0 1 1-2 0v-1.6c-2.5-.3-4.3-1.9-4.5-4.1a1 1 0 0 1 2-.2c.1 1.2 1.3 2.1 3 2.2h1c1.6 0 2.7-.8 2.7-2 0-1-.7-1.6-2.5-2l-1.5-.3C7.3 11.6 6 10.3 6 8.2c0-2.1 1.7-3.6 4-4V3a1 1 0 0 1 1-1h1Z";

/** The mark a status card shows: what the status *means*, not a service. */
export const STATUS_GLYPH: Record<CustomerStatus, string> = {
  lead: HOUSE_GLYPH,
  quoted: QUOTE_GLYPH,
  customer: DOLLAR_GLYPH,
  not_interested: NO_GLYPH,
  do_not_knock: BAN_GLYPH,
};

/**
 * What goes inside this customer's pin: the status mark. A map of ninety
 * pins is read by colour first and picture second, and both saying the
 * same thing — orange house, green dollar, red no-entry — is what makes it
 * legible from arm's length. The service they want is on the form and the
 * record, where there is room to read it.
 */
export function pinGlyphFor(status: CustomerStatus): string {
  return STATUS_GLYPH[status];
}

export function Glyph({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "size-5"} aria-hidden="true">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

/**
 * The pin: a round badge in the status colour with the status mark inside,
 * a white ring and a soft shadow. No stem — the badge sits centred on the
 * house, which is how the map the owner pointed at reads, and it is what
 * lets ninety of them sit on a street without turning into a picket fence.
 *
 * One SVG, because each extra element is paid for ninety times. The ring
 * and the shadow are what keep a yellow badge readable over a sunlit roof
 * and a black one readable over asphalt.
 */
export function PinMark({
  status,
  glyph,
  selected = false,
  draft = false,
  className,
}: {
  status: CustomerStatus | "draft";
  glyph: string;
  selected?: boolean;
  draft?: boolean;
  className?: string;
}) {
  const fill = status === "draft" ? "#00d9ff" : STATUS_COLOR[status];
  const ink = status === "draft" ? "#00181f" : STATUS_INK[status];
  // Black on black needs a visible edge even when nothing is selected.
  const ring = selected ? "#00d9ff" : status === "do_not_knock" ? "#9ba7b4" : "#ffffff";

  return (
    <svg
      viewBox="0 0 40 40"
      className={className ?? "size-9"}
      aria-hidden="true"
      style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.55))" }}
    >
      {selected ? <circle cx="20" cy="20" r="19.5" fill="#00d9ff" opacity={0.35} /> : null}
      <circle
        cx="20"
        cy="20"
        r={selected ? 14.5 : 15}
        fill={fill}
        stroke={ring}
        strokeWidth={selected ? 3 : 2.5}
        strokeDasharray={draft ? "4 3" : undefined}
      />
      <g transform="translate(10.4 10.4) scale(0.8)" fill={ink}>
        <path d={glyph} />
      </g>
    </svg>
  );
}

/** The pin for a customer record. */
export function customerPinGlyph(customer: Pick<Customer, "status">): string {
  return pinGlyphFor(customer.status);
}
