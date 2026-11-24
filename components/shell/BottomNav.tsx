"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { isShown } from "@/lib/menuVisibility";
import { buildThreads, needsReplyCount } from "@/lib/threads";
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
  // A tab switched off on the Account screen leaves the bar as well as the
  // drawer; the rest spread out to fill it.
  const { me } = useTeam();
  const { customers } = useCustomers();

  // Messages is a drawer destination, not one of the five tabs, so on a phone a
  // customer's reply was invisible until somebody thought to go looking for it.
  // The drawer's own Messages row carries the number; this is just the dot that
  // says the number is worth going to read. Same derivation as the drawer's, so
  // the two cannot disagree.
  const unanswered = useMemo(() => needsReplyCount(buildThreads(customers)), [customers]);

  return (
    <nav
      aria-label="Main"
      className="pb-safe z-30 flex shrink-0 desktop:hidden items-stretch justify-around gap-1 border-t border-line bg-surface px-2 pt-2"
    >
      {TABS.filter((tab) => isShown(tab.href, me?.hiddenMenu)).map(({ href, label, icon: Icon }) => {
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
        aria-label={
          unanswered > 0
            ? `Open menu, ${unanswered} waiting on a reply`
            : "Open menu"
        }
        className="tap-target flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-bold text-muted transition hover:text-ink"
      >
        <span className="relative">
          <MenuIcon />
          {unanswered > 0 ? (
            <span
              className="absolute -right-1 -top-0.5 size-2.5 rounded-full bg-accent ring-2 ring-surface"
              aria-hidden="true"
            />
          ) : null}
        </span>
        More
      </button>
    </nav>
  );
}
