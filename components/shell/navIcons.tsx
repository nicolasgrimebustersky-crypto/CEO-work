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
