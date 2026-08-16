"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MenuIcon } from "./navIcons";
import { isActive, TABS } from "./navItems";

/**
 * Five destinations and a menu button.
 *
 * Seven tabs fitted on a 390px phone, but only barely — 56px each, with the
 * labels at eleven pixels. Five gives every tab room for a real touch target
 * and an active pill you can see at arm's length, and the two that moved into
 * the drawer are the two you read sitting down.
 */
export function BottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="pb-safe z-30 flex shrink-0 items-stretch justify-around gap-1 border-t border-line bg-surface px-2 pt-2"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`tap-target flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-bold transition ${
              active ? "nav-active text-accent" : "text-muted hover:text-ink"
            }`}
          >
            <Icon active={active} />
            {label}
          </Link>
        );
      })}

      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="tap-target flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-bold text-muted transition hover:text-ink"
      >
        <MenuIcon />
        More
      </button>
    </nav>
  );
}
