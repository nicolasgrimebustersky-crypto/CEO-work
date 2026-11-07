"use client";

import { useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { ALL_DESTINATIONS } from "@/components/shell/navItems";
import { setHiddenMenu } from "@/lib/db/users";
import { canHide, isShown, toggleHidden } from "@/lib/menuVisibility";

/**
 * An on/off switch for every screen in the menu.
 *
 * Per person, saved on their own profile, so it follows them to another
 * phone. Off takes the screen out of the menu and, for the five tabs, out of
 * the bottom bar too. It does not switch the feature off or change who may
 * see what — that stays with the security rules.
 */
export function MenuSettings() {
  const { me, author } = useTeam();
  const [error, setError] = useState<string | null>(null);
  const hidden = me?.hiddenMenu ?? [];
  const items = ALL_DESTINATIONS.filter((item) => canHide(item.href));
  const offCount = items.filter((item) => !isShown(item.href, hidden)).length;

  async function flip(href: string) {
    if (!author) return;
    setError(null);
    try {
      // The roster listener writes the saved value back into `me`.
      await setHiddenMenu(author.uid, toggleHidden(hidden, href));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    }
  }

  return (
    <section>
      <h2 className="mb-1 text-lg font-bold text-ink">Menu</h2>
      <p className="mb-2 text-sm font-semibold text-muted">
        Switch off the screens you don&apos;t use and they leave your menu. Only your menu changes — the
        feature keeps working (miles still log from &ldquo;En route&rdquo;), and you can switch it back on here
        any time.{offCount > 0 ? ` ${offCount} off.` : ""}
      </p>
      {error ? (
        <p role="alert" className="mb-2 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {items.map(({ href, label, hint }) => {
          const on = isShown(href, hidden);
          return (
            <li
              key={href}
              className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3"
            >
              <div className="min-w-0">
                <p className="text-base font-bold text-ink">{label}</p>
                {hint ? <p className="mt-0.5 text-sm font-semibold text-muted">{hint}</p> : null}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`Show ${label} in the menu`}
                disabled={!author}
                onClick={() => void flip(href)}
                className={`tap-target relative flex w-16 shrink-0 items-center rounded-full p-1 transition ${
                  on ? "bg-accent" : "bg-surface-3"
                }`}
              >
                <span
                  className={`size-8 rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-0"}`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
