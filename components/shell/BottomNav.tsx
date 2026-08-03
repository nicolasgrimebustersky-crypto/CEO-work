"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Seven tabs is the ceiling for a 390px phone — the labels are already at
 * eleven pixels. Anything else that needs a home goes behind one of these
 * rather than getting its own tab.
 */
const TABS = [
  { href: "/map", label: "Map", icon: MapIcon },
  { href: "/schedule", label: "Jobs", icon: CalendarIcon },
  { href: "/invoices", label: "Money", icon: InvoiceIcon },
  { href: "/pipeline", label: "Leads", icon: PipelineIcon },
  { href: "/customers", label: "People", icon: ListIcon },
  { href: "/dashboard", label: "Home", icon: ChartIcon },
  { href: "/account", label: "You", icon: PersonIcon },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="pb-safe z-30 flex shrink-0 items-stretch justify-around border-t border-line bg-surface pt-1"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`tap-target flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-bold ${
              active ? "text-accent" : "text-muted"
            }`}
          >
            <Icon active={active} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function MapIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Zm0 0v15m6-12v15"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 1.9}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon({ active }: { active: boolean }) {
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
        strokeWidth={active ? 2.4 : 1.9}
      />
      <path
        d="M3.5 10h17M8 3v4m8-4v4"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 1.9}
        strokeLinecap="round"
      />
    </svg>
  );
}

function InvoiceIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M6 3h12v18l-3-1.6-3 1.6-3-1.6L6 21V3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 1.9}
        strokeLinejoin="round"
      />
      <path
        d="M9.5 8h5M9.5 12h5"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 1.9}
        strokeLinecap="round"
      />
    </svg>
  );
}

function PipelineIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <rect x="3" y="4" width="5" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 1.9} />
      <rect x="9.5" y="4" width="5" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 1.9} />
      <rect x="16" y="4" width="5" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 1.9} />
    </svg>
  );
}

function ChartIcon({ active }: { active: boolean }) {
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

function ListIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M4 6h16M4 12h16M4 18h16"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.6 : 2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function PersonIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <circle
        cx="12"
        cy="8"
        r="3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 1.9}
      />
      <path
        d="M4.5 20a7.5 7.5 0 0 1 15 0"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.4 : 1.9}
        strokeLinecap="round"
      />
    </svg>
  );
}
