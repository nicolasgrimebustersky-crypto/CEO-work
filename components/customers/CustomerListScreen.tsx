"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { FilterSheet } from "@/components/map/FilterSheet";
import { useCustomers } from "@/components/providers/CustomersProvider";
import { useOpenMenu } from "@/components/shell/menu";
import { MenuIcon } from "@/components/shell/navIcons";
import { useTeam } from "@/components/providers/TeamProvider";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { StatusPill } from "@/components/ui/Chips";
import { Spinner } from "@/components/ui/Spinner";
import { BlastSheet } from "./BlastSheet";
import { NewCustomerSheet } from "./NewCustomerSheet";
import {
  activeFilterCount,
  applyFilters,
  EMPTY_FILTERS,
  searchCustomers,
} from "@/lib/filters";
import type { CustomerFilters } from "@/lib/filters";
import { customerName, formatMoney, formatRelative } from "@/lib/format";
import type { Customer } from "@/lib/types";
import { routes } from "@/lib/routes";

const SORTS = [
  { value: "recent", label: "Newest" },
  { value: "contacted", label: "Last contacted" },
  { value: "name", label: "Name" },
  { value: "value", label: "Revenue" },
] as const;

type SortKey = (typeof SORTS)[number]["value"];

function sortCustomers(customers: Customer[], key: SortKey): Customer[] {
  const copy = [...customers];
  switch (key) {
    case "recent":
      return copy.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    case "contacted":
      // Never-contacted records sort last rather than first — a missing date is
      // not "contacted infinitely long ago", it's a record nobody has worked.
      return copy.sort(
        (a, b) =>
          (b.lastContactedAt?.toMillis() ?? 0) - (a.lastContactedAt?.toMillis() ?? 0),
      );
    case "name":
      return copy.sort((a, b) =>
        customerName(a).localeCompare(customerName(b), undefined, {
          sensitivity: "base",
        }),
      );
    case "value":
      return copy.sort((a, b) => b.lifetimeValue - a.lifetimeValue);
    default:
      return copy;
  }
}

export function CustomerListScreen() {
  const { customers, loading, error } = useCustomers();
  const { colorFor } = useTeam();
  const openMenu = useOpenMenu();

  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [filters, setFilters] = useState<CustomerFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [blastOpen, setBlastOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const router = useRouter();

  const rows = useMemo(
    () => sortCustomers(searchCustomers(applyFilters(customers, filters), term), sort),
    [customers, filters, term, sort],
  );
  const filterCount = activeFilterCount(filters);

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe shrink-0 border-b border-line bg-surface px-3 pb-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {openMenu ? (
              <button
                type="button"
                onClick={openMenu}
                aria-label="Open menu"
                className="tap-target -ml-2 flex shrink-0 items-center justify-center rounded-2xl px-2 text-muted hover:bg-surface-2 hover:text-ink"
              >
                <MenuIcon />
              </button>
            ) : null}
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">Customers</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Typing somebody in, for the leads that never involved a door:
                a referral over the phone, a number on a napkin. */}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="tap-target rounded-xl bg-accent px-3 text-sm font-bold text-accent-ink"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setBlastOpen(true)}
              disabled={rows.length === 0}
              className="tap-target rounded-xl border border-line bg-surface-2 px-3 text-sm font-bold text-ink disabled:opacity-50"
            >
              Text {rows.length}
            </button>
            <NotificationBell />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search name, address, phone…"
            aria-label="Search customers"
            className="tap-target min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            aria-label={`Filters${filterCount > 0 ? `, ${filterCount} active` : ""}`}
            className="tap-target relative flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink"
          >
            <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
              <path
                d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            </svg>
            {filterCount > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-accent-ink">
                {filterCount}
              </span>
            ) : null}
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-0.5">
          <span className="shrink-0 text-sm font-bold text-muted">Sort</span>
          {SORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={sort === option.value}
              onClick={() => setSort(option.value)}
              className={`tap-target shrink-0 rounded-full border px-3.5 py-2 text-sm font-bold transition ${
                sort === option.value
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line bg-surface-2 text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? <Spinner label="Loading customers…" /> : null}

        {error ? (
          <p
            role="alert"
            className="m-3 rounded-xl border border-danger/60 bg-danger/15 px-3 py-3 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}

        {!loading && rows.length === 0 ? (
          <p className="p-6 text-center text-base font-semibold text-muted">
            {customers.length === 0
              ? "No customers yet. Drop a pin on the map to add the first one."
              : "Nothing matches that search or filter."}
          </p>
        ) : null}

        <ul className="divide-y divide-line">
          {rows.map((customer) => (
            <li key={customer.id}>
              <Link
                href={routes.customer(customer.id)}
                className="flex items-start gap-3 px-3 py-3.5 active:bg-surface-2"
              >
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: colorFor(customer.createdBy) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-base font-bold text-ink">
                      {customerName(customer)}
                    </span>
                    <StatusPill status={customer.status} />
                  </span>
                  {customer.address ? (
                    <span className="mt-0.5 block truncate text-sm font-semibold text-muted">
                      {customer.address}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block text-sm font-semibold text-muted">
                    Contacted {formatRelative(customer.lastContactedAt)}
                    {customer.lifetimeValue > 0
                      ? ` · ${formatMoney(customer.lifetimeValue)} lifetime`
                      : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <FilterSheet
        open={filterOpen}
        filters={filters}
        matchCount={rows.length}
        onChange={setFilters}
        onClose={() => setFilterOpen(false)}
      />

      {/* The blast targets exactly what the list is showing right now. */}
      <BlastSheet
        recipients={rows}
        open={blastOpen}
        onClose={() => setBlastOpen(false)}
      />

      <NewCustomerSheet
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(id) => router.push(routes.customer(id))}
      />
    </div>
  );
}
