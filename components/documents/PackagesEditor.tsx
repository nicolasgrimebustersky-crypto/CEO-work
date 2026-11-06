"use client";

import { Button } from "@/components/ui/Button";
import { formatMoneyExact } from "@/lib/format";
import { defaultPackages, MAX_PACKAGES, pricePackages } from "@/lib/packages";
import { lineItemsFrom, toNumber, type Draft } from "./draft";

/**
 * Turning an estimate into Good / Better / Best, and naming the options.
 *
 * Off by default — most estimates are one price. Switched on, it starts with
 * three named packages; each line is then put in one of them or left in all
 * (the chips on each line, in LineItemsEditor). The running price of every
 * package sits underneath so the crew sees what the customer will choose
 * between before sending it.
 */
export function PackagesEditor({
  draft,
  onChange,
  disabled = false,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  disabled?: boolean;
}) {
  const on = draft.packages.length > 0;

  if (!on) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-3 py-3">
        <span>
          <span className="block text-base font-bold text-ink">Good / Better / Best</span>
          <span className="block text-sm font-semibold text-muted">
            Offer 2–3 options and let the customer pick one.
          </span>
        </span>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => onChange({ ...draft, packages: defaultPackages() })}
        >
          Offer packages
        </Button>
      </div>
    );
  }

  const priced = pricePackages(
    lineItemsFrom(draft),
    draft.packages,
    toNumber(draft.discount),
    toNumber(draft.taxRatePct),
  );

  return (
    <div className="rounded-2xl border border-accent/40 bg-accent/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-bold text-ink">Packages</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...draft,
              packages: [],
              lines: draft.lines.map((line) => ({ ...line, package: "" })),
            })
          }
          className="text-sm font-bold text-muted underline"
        >
          Turn off
        </button>
      </div>
      <p className="mt-0.5 text-sm font-semibold text-muted">
        Lines marked &ldquo;All&rdquo; are in every package. Put each extra in the package it
        belongs to.
      </p>

      <ul className="mt-2 flex flex-col gap-2">
        {draft.packages.map((pkg, index) => (
          <li key={pkg.id} className="flex items-center gap-2">
            <input
              value={pkg.name}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...draft,
                  packages: draft.packages.map((entry) =>
                    entry.id === pkg.id ? { ...entry, name: event.target.value } : entry,
                  ),
                })
              }
              aria-label={`Package ${index + 1} name`}
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-base font-semibold text-ink"
            />
            <span className="w-24 shrink-0 text-right text-base font-extrabold text-money tabular-nums">
              {formatMoneyExact(priced[index]?.totals.total ?? 0)}
            </span>
            {draft.packages.length > 2 ? (
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove package ${pkg.name}`}
                onClick={() =>
                  onChange({
                    ...draft,
                    packages: draft.packages.filter((entry) => entry.id !== pkg.id),
                    lines: draft.lines.map((line) =>
                      line.package === pkg.id ? { ...line, package: "" } : line,
                    ),
                  })
                }
                className="tap-target shrink-0 rounded-xl px-2 text-xl text-muted"
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {draft.packages.length < MAX_PACKAGES ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const used = new Set(draft.packages.map((pkg) => pkg.id));
            const id = ["pkg1", "pkg2", "pkg3"].find((candidate) => !used.has(candidate)) ?? `pkg${Date.now()}`;
            onChange({ ...draft, packages: [...draft.packages, { id, name: "Best" }] });
          }}
          className="mt-2 text-sm font-bold text-accent"
        >
          + Add a package
        </button>
      ) : null}
    </div>
  );
}
