"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CustomerPickerSheet } from "@/components/documents/CustomerPickerSheet";
import { useDocuments } from "@/components/providers/DocumentsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { IconTile } from "@/components/ui/Card";
import { Logo } from "@/components/ui/Logo";
import { BUSINESS } from "@/lib/business";
import { formatMoney, initialsFor } from "@/lib/format";
import { routes } from "@/lib/routes";
import { PlusIcon } from "./navIcons";
import { ALL_DESTINATIONS, isActive } from "./navItems";

/**
 * The side drawer.
 *
 * It holds every destination, not only the ones the bottom bar dropped — so
 * the drawer is a complete map of the app rather than an overflow bin, and you
 * never have to remember which half of the navigation something lives in.
 */
export function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { author, colorFor } = useTeam();
  const { outstanding } = useDocuments();
  const [picking, setPicking] = useState(false);

  // Escape closes it, matching the sheets everywhere else in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Tapping a destination should not leave the drawer hanging open over it.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close on navigation only
  }, [pathname]);

  if (!open && !picking) return null;

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={onClose}
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="pt-safe pb-safe relative flex w-[82%] max-w-sm flex-col overflow-y-auto border-r border-line bg-surface px-4"
            style={{ animation: "gb-drawer-in 180ms ease-out" }}
          >
            <div className="flex items-center justify-between gap-3 pt-2 pb-5">
              <div className="min-w-0">
                {/* The lockup carries the business name, so printing it again
                    underneath would just be the same words twice. */}
                <Logo width={168} priority />
                <p className="mt-1 text-sm font-semibold text-muted">{BUSINESS.address}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="tap-target -mr-2 flex items-center justify-center rounded-2xl px-3 text-2xl leading-none text-muted hover:bg-surface-2 hover:text-ink"
              >
                ×
              </button>
            </div>

            {/* The white pill from the reference: the one thing on this panel
                that starts work rather than going somewhere. */}
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="tap-target mb-2 flex w-full items-center gap-3 rounded-full bg-ink px-5 py-3.5 text-base font-bold text-canvas transition hover:brightness-95"
            >
              <PlusIcon />
              New estimate
            </button>

            {/* Money is the reason the app gets opened, so it is legible from
                the drawer without navigating anywhere. */}
            <Link
              href={routes.invoices}
              className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3"
            >
              <span className="text-sm font-bold text-muted">Owed to you</span>
              <span className="text-lg font-extrabold text-money tabular-nums">
                {formatMoney(outstanding)}
              </span>
            </Link>

            <nav aria-label="All screens" className="flex flex-col gap-1 pb-4">
              {ALL_DESTINATIONS.map(({ href, label, icon: Icon, hint }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`tap-target flex items-center gap-3 rounded-2xl px-3 py-2.5 transition ${
                      active ? "nav-active text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    <Icon active={active} />
                    <span className="min-w-0">
                      <span
                        className={`block text-base font-bold ${active ? "text-accent" : "text-ink"}`}
                      >
                        {label}
                      </span>
                      {hint ? (
                        <span className="block text-sm font-semibold text-muted">{hint}</span>
                      ) : null}
                    </span>
                  </Link>
                );
              })}
            </nav>

            {author ? (
              <Link
                href={routes.account}
                className="mt-auto mb-2 flex items-center gap-3 rounded-2xl border border-line bg-surface-2 px-3 py-3"
              >
                <IconTile>
                  <span
                    className="flex size-full items-center justify-center rounded-2xl text-sm font-extrabold text-canvas"
                    style={{ backgroundColor: colorFor(author.uid) }}
                  >
                    {initialsFor(author.displayName)}
                  </span>
                </IconTile>
                <span className="min-w-0">
                  <span className="block truncate text-base font-bold text-ink">
                    {author.displayName}
                  </span>
                  <span className="block text-sm font-semibold text-muted">
                    Signed in · tap for account
                  </span>
                </span>
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <CustomerPickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(customerId) => {
          setPicking(false);
          onClose();
          router.push(routes.newDocument("estimate", customerId));
        }}
      />
    </>
  );
}
