/**
 * Navigation glyphs, shared by the bottom tabs and the drawer so a destination
 * is drawn the same way wherever it appears.
 *
 * Every icon takes `active` and thickens its stroke rather than switching to a
 * filled variant. On a small dark screen a weight change reads as clearly as a
 * shape change and needs half the SVG.
 */
export interface NavIconProps {
  active?: boolean;
}

const w = (active?: boolean) => (active ? 2.4 : 1.9);

export function MapIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Zm0 0v15m6-12v15"
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A path between two dropped pins — a walking route, not a map. */
export function RouteIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <circle
        cx={6}
        cy={6}
        r={2.6}
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
      />
      <circle
        cx={18}
        cy={18}
        r={2.6}
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
      />
      <path
        d="M8.6 6H14a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinecap="round"
        strokeDasharray="0.1 3.4"
      />
    </svg>
  );
}

export function CalendarIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <rect
        x="3.5"
        y="5"
        width="17"
        height="15"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
      />
      <path
        d="M3.5 10h17M8 3v4m8-4v4"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function InvoiceIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M6 3h12v18l-3-1.6-3 1.6-3-1.6L6 21V3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinejoin="round"
      />
      <path
        d="M9.5 8h5M9.5 12h5"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MessageIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M4 5h16v11H9l-5 4V5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinejoin="round"
      />
      <path
        d="M8 9h8M8 12.5h5"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PipelineIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <rect x="3" y="4" width="5" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth={w(active)} />
      <rect x="9.5" y="4" width="5" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth={w(active)} />
      <rect x="16" y="4" width="5" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth={w(active)} />
    </svg>
  );
}

export function ChartIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M5 19V11m7 8V5m7 14v-6"
        stroke="currentColor"
        strokeWidth={active ? 2.8 : 2.2}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PeopleIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth={w(active)} />
      <path
        d="M2.5 20a6.5 6.5 0 0 1 13 0"
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinecap="round"
      />
      <path
        d="M16 5.4a3.2 3.2 0 0 1 0 5.2M17.5 14.6A6.5 6.5 0 0 1 21.5 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PersonIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" strokeWidth={w(active)} />
      <path
        d="M4.5 20a7.5 7.5 0 0 1 15 0"
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ReportIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth={w(active)} />
      <path
        d="M8 16v-3.5M12 16V8m4 8v-5"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PriceBookIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M4 5.2A2.2 2.2 0 0 1 6.2 3H19v15H6.2A2.2 2.2 0 0 0 4 20.2V5.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinejoin="round"
      />
      <path
        d="M19 18v3H6.2A2.2 2.2 0 0 1 4 18.8M8.5 8h6.5M8.5 11.5h4"
        fill="none"
        stroke="currentColor"
        strokeWidth={w(active)}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MenuIcon({ active }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.6 : 2}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </svg>
  );
}
