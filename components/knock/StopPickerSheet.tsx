"use client";

import { useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useTerritories } from "@/components/providers/TerritoriesProvider";
import { knockableOnly } from "@/lib/knock/plan";
import { within } from "@/lib/knock/territory";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { customerName } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/status";
import { CUSTOMER_STATUSES, type Customer, type CustomerStatus } from "@/lib/types";

/**
 * Choosing which doors go on a route.
 *
 * Multi-select, because a route is twenty doors and picking them one sheet at a
 * time is not a thing anybody would do twice. The filters are the ones that
 * actually start a route: a status ("all the leads I quoted and never heard
 * back from") and a street ("everything on Ridgemoor").
 *
 * Do-not-knock is filtered out and cannot be selected. That flag exists because
 * somebody asked to be left alone, and the one place it absolutely has to hold
 * is the screen whose entire purpose is deciding whose door to knock on.
 */
export function StopPickerSheet({
  open,
  onClose,
  selectedIds,
  onDone,
  /** Doors already on another live route, shown but flagged. */
  takenIds,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  onDone: (ids: string[]) => void;
  takenIds?: Set<string>;
}) {
  const { customers } = useCustomers();
  const { territories } = useTerritories();
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState<CustomerStatus | "any">("any");
  const [picked, setPicked] = useState<string[]>(selectedIds);
  const [dirty, setDirty] = useState(false);

  // Reopening the sheet should show the route as it stands now, not whatever
  // was picked the last time it was open.
  const current = dirty ? picked : selectedIds;

  const results = useMemo(() => {
    const needle = term.trim().toLowerCase();
    // Existing customers and do-not-knocks never appear. You do not cold-pitch
    // somebody who already buys from you, and the one screen where a
    // do-not-knock absolutely has to hold is this one.
    return knockableOnly(customers)
      .filter((customer) => status === "any" || customer.status === status)
      .filter((customer) => {
        if (!needle) return true;
        return `${customerName(customer)} ${customer.address}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => a.address.localeCompare(b.address) || customerName(a).localeCompare(customerName(b)))
      .slice(0, 120);
  }, [customers, term, status]);

  const toggle = (id: string) => {
    setDirty(true);
    setPicked(
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const addAll = () => {
    setDirty(true);
    setPicked([...new Set([...current, ...results.map((customer) => customer.id)])]);
  };

  const label = (customer: Customer) => customer.address || "No address yet";

  return (
    <Sheet
      open={open}
      title="Where are you knocking?"
      onClose={onClose}
      footer={
        <Button
          full
          onClick={() => {
            onDone(current);
            setDirty(false);
          }}
        >
          {current.length === 0
            ? "Done"
            : `Use ${current.length} door${current.length === 1 ? "" : "s"}`}
        </Button>
      }
    >
      {/* Territories first: a territory is how you decide where to knock, and
          picking one is a single tap instead of twenty. The search below is
          still there for the odd door you want to add or drop by hand. */}
      {territories.length > 0 ? (
        <div className="mb-4">
          <p className="mb-1.5 text-sm font-bold tracking-wide text-muted uppercase">
            Add a whole territory
          </p>
          <div className="flex flex-wrap gap-2">
            {territories
              .filter((territory) => territory.active)
              .map((territory) => {
                const inside = knockableOnly(within(customers, territory.boundary));
                return (
                  <button
                    key={territory.id}
                    type="button"
                    disabled={inside.length === 0}
                    onClick={() => {
                      setDirty(true);
                      setPicked([
                        ...new Set([...current, ...inside.map((c) => c.id)]),
                      ]);
                    }}
                    className="tap-target rounded-full border border-accent/50 bg-accent/10 px-4 text-sm font-bold text-ink disabled:opacity-45"
                  >
                    {territory.name} · {inside.length}
                  </button>
                );
              })}
          </div>
          <p className="mt-1.5 text-sm font-semibold text-muted">
            The number is how many doors are still worth knocking in it.
          </p>
        </div>
      ) : (
        <p className="mb-4 rounded-xl border border-line bg-surface-2 p-3 text-sm font-semibold text-muted">
          Draw a territory on the map and it shows up here — that is the quickest
          way to fill a route.
        </p>
      )}

      <p className="mb-1.5 text-sm font-bold tracking-wide text-muted uppercase">
        Or pick doors one by one
      </p>
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Street or name"
        aria-label="Search doors"
        className="tap-target w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={status === "any"} onClick={() => setStatus("any")}>
          Any status
        </Chip>
        {CUSTOMER_STATUSES.filter((entry) => entry !== "do_not_knock").map((entry) => (
          <Chip key={entry} active={status === entry} onClick={() => setStatus(entry)}>
            {STATUS_LABEL[entry]}
          </Chip>
        ))}
      </div>

      {results.length > 0 ? (
        <button
          type="button"
          onClick={addAll}
          className="tap-target mt-3 w-full rounded-xl border border-accent/50 bg-accent/10 px-3 text-base font-semibold text-ink"
        >
          Add all {results.length} showing
        </button>
      ) : null}

      {results.length === 0 ? (
        <p className="mt-4 text-base font-semibold text-muted">
          No doors match that. Existing customers are not shown — you do not
          knock somebody who already buys from you.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {results.map((customer) => {
            const on = current.includes(customer.id);
            const taken = takenIds?.has(customer.id) ?? false;
            return (
              <li key={customer.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(customer.id)}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left ${
                    on ? "border-accent/60 bg-accent/10" : "border-line bg-surface-2"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-black ${
                      on ? "border-accent bg-accent text-accent-ink" : "border-line"
                    }`}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-bold break-words text-ink">
                      {customerName(customer)}
                    </span>
                    <span className="block text-sm font-semibold break-words text-muted">
                      {label(customer)} · {STATUS_LABEL[customer.status]}
                    </span>
                    {taken && !on ? (
                      <span className="mt-0.5 block text-sm font-bold text-warn">
                        Already on another route
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
