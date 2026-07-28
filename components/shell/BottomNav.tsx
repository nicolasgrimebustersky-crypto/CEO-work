"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/map", label: "Map", icon: MapIcon },
  { href: "/customers", label: "Customers", icon: ListIcon },
  { href: "/account", label: "Account", icon: PersonIcon },
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
            className={`tap-target flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-bold ${
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
