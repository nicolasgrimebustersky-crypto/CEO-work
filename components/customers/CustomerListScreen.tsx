"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { FilterSheet } from "@/components/map/FilterSheet";
import { useCustomers } from "@/components/providers/CustomersProvider";
import { useDocuments } from "@/components/providers/DocumentsProvider";
import { useOpenMenu } from "@/components/shell/menu";
import { MenuIcon } from "@/components/shell/navIcons";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { BlastSheet } from "./BlastSheet";
import { NewCustomerSheet } from "./NewCustomerSheet";
import {
  avatarColor,
  clientMoney,
  invoiceCountLabel,
  isNewClient,
  type ClientMoney,
} from "@/lib/clientList";
import { compactMoney } from "@/lib/documentPeriods";
import { activeFilterCount, applyFilters, EMPTY_FILTERS, searchCustomers } from "@/lib/filters";
import type { CustomerFilters } from "@/lib/filters";
import { customerName, initialsFor } from "@/lib/format";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/status";
import type { Customer } from "@/lib/types";
import { routes } from "@/lib/routes";

/**
 * Every client, one rounded list, and what each one is worth at a glance.
 *
 * The layout is the one the owner asked for: a title, a search pill with sort
 * and filter beside it, then one card of rows — an initials disc, the name,
 * how many invoices, and on the right what they have been invoiced and how
 * much of it is paid. A floating pill adds a client by hand.
 *
 * What is kept from the old screen, because it earns its place: the filter
 * sheet shared with the map, the "text everyone shown" blast, and the
 * customer's pin status as a small dot on the disc — lead, quoted, customer,
 * do-not-knock — since that is what decides whether to knock again.
 */

const SORTS = [
  { value: "name", label: "Name, A to Z" },
  { value: "recent", label: "Newest first" },
  { value: "contacted", label: "Last contacted" },
  { value: "value", label: "Most invoiced" },
] as const;

type SortKey = (typeof SORTS)[number]["value"];

function sortCustomers(
  customers: Customer[],
  key: SortKey,
  money: Map<string, ClientMoney>,
): Customer[] {
  const copy = [...customers];
  switch (key) {
    case "recent":
      return copy.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    case "contacted":
      // Never-contacted records sort last rather than first — a missing date is
      // not "contacted infinitely long ago", it's a record nobody has worked.
      return copy.sort(
        (a, b) => (b.lastContactedAt?.toMillis() ?? 0) - (a.lastContactedAt?.toMillis() ?? 0),
      );
    case "name":
      return copy.sort((a, b) =>
        customerName(a).localeCompare(customerName(b), undefined, {
          sensitivity: "base",
        }),
      );
    case "value":
      return copy.sort(
        (a, b) => (money.get(b.id)?.invoiced ?? 0) - (money.get(a.id)?.invoiced ?? 0),
      );
    default:
      return copy;
  }
}

export function CustomerListScreen() {
  const { customers, loading, error } = useCustomers();
  const { forCustomer } = useDocuments();
  const openMenu = useOpenMenu();
  const router = useRouter();

  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [sorting, setSorting] = useState(false);
  const [filters, setFilters] = useState<CustomerFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [blastOpen, setBlastOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const money = useMemo(
    () => new Map(customers.map((c) => [c.id, clientMoney(forCustomer(c.id))])),
    [customers, forCustomer],
  );

  const rows = useMemo(
    () => sortCustomers(searchCustomers(applyFilters(customers, filters), term), sort, money),
    [customers, filters, term, sort, money],
  );
  const filterCount = activeFilterCount(filters);
  const sortLabel = SORTS.find((s) => s.value === sort)?.label ?? "";

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-canvas">
      <div
        aria-hidden
        className="gb-money-glow-accent pointer-events-none absolute inset-x-0 top-0 h-[40vh]"
      />

      {/* ------------------------------------------------------------ top */}
      <header className="pt-safe relative z-10 shrink-0 px-4 pb-3">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[2rem] leading-none font-extrabold tracking-tight text-ink">
              Clients
            </h1>
            <div className="flex items-center gap-2">
              <NotificationBell />
              {openMenu ? (
                <RoundButton label="Open menu" onClick={openMenu}>
                  <MenuIcon />
                </RoundButton>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface-2/80 px-4 backdrop-blur focus-within:border-accent">
              <SearchIcon />
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search"
                aria-label="Search clients by name, address or phone"
                className="tap-target min-w-0 flex-1 bg-transparent py-3 text-base text-ink placeholder:text-muted/80 focus:outline-none"
              />
            </label>
            <RoundButton label={`Sort: ${sortLabel}`} onClick={() => setSorting(true)}>
              <SortIcon />
            </RoundButton>
            <RoundButton
              label={`Filters${filterCount > 0 ? `, ${filterCount} active` : ""}`}
              pressed={filterCount > 0}
              onClick={() => setFilterOpen(true)}
            >
              <FilterIcon />
              {filterCount > 0 ? (
                <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-accent-ink">
                  {filterCount}
                </span>
              ) : null}
            </RoundButton>
          </div>

          {!loading && rows.length > 0 ? (
            <div className="mt-3 flex items-center justify-between px-1 text-sm font-bold text-muted">
              <span>
                {rows.length} {rows.length === 1 ? "client" : "clients"}
                {rows.length !== customers.length ? ` of ${customers.length}` : ""}
              </span>
              {/* The blast targets exactly what the list is showing right now. */}
              <button
                type="button"
                onClick={() => setBlastOpen(true)}
                className="tap-target -mr-1 rounded-full px-2 text-accent"
              >
                Text {rows.length === customers.length ? "everyone" : "these"}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {/* --------------------------------------------------------- scroll */}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto max-w-3xl pb-28">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner label="Loading clients…" />
            </div>
          ) : error ? (
            <p
              role="alert"
              className="rounded-2xl border border-danger/60 bg-danger/15 px-4 py-3 text-base font-semibold text-ink"
            >
              {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-3xl border border-line bg-surface px-4 py-8 text-center text-base font-semibold text-muted">
              {customers.length === 0
                ? "No clients yet. Add one here, or drop a pin on the map."
                : "Nothing matches that search or filter."}
            </p>
          ) : (
            <ul className="overflow-hidden rounded-3xl border border-line bg-surface">
              {rows.map((customer) => (
                <li key={customer.id} className="border-b border-line last:border-b-0">
                  <ClientRow
                    customer={customer}
                    money={money.get(customer.id) ?? clientMoney([])}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ add */}
      <div className="pointer-events-none absolute right-4 bottom-4 z-20">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="gb-cta-accent pointer-events-auto flex h-14 items-center gap-2 rounded-full pr-6 pl-5 text-base font-extrabold tracking-wide text-accent-ink uppercase transition hover:brightness-110 active:brightness-95"
        >
          <span className="text-2xl leading-none font-bold">+</span>
          Add client
        </button>
      </div>

      <Sheet open={sorting} title="Sort clients" onClose={() => setSorting(false)}>
        <ul className="flex flex-col gap-2">
          {SORTS.map((option) => {
            const active = sort === option.value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSort(option.value);
                    setSorting(false);
                  }}
                  className={`tap-target flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-base font-bold ${
                    active
                      ? "border-accent bg-accent/15 text-ink"
                      : "border-line bg-surface-2 text-ink active:bg-surface-3"
                  }`}
                >
                  {option.label}
                  {active ? (
                    <span aria-hidden className="text-accent">
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>

      <FilterSheet
        open={filterOpen}
        filters={filters}
        matchCount={rows.length}
        onChange={setFilters}
        onClose={() => setFilterOpen(false)}
      />

      <BlastSheet recipients={rows} open={blastOpen} onClose={() => setBlastOpen(false)} />

      <NewCustomerSheet
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(id) => router.push(routes.customer(id))}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function ClientRow({ customer, money }: { customer: Customer; money: ClientMoney }) {
  const name = customerName(customer);
  // A pin dropped at a door before anyone answered has an address and no
  // name, and "51" is not anybody's initials.
  const named = `${customer.firstName}${customer.lastName}`.trim().length > 0;
  const fresh = isNewClient(customer.createdAt.toMillis(), money.invoiceCount);
  return (
    <Link
      href={routes.customer(customer.id)}
      className="flex items-center gap-3.5 px-4 py-3.5 active:bg-surface-2"
    >
      <span className="relative shrink-0">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full text-base font-extrabold text-white"
          style={{ backgroundColor: avatarColor(name) }}
        >
          {named ? initialsFor(name) : <PinGlyph />}
        </span>
        {/* The pin status, as a dot on the disc: the one thing about a
            client that decides whether to knock on that door again. */}
        <span
          role="img"
          aria-label={STATUS_LABEL[customer.status]}
          className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-2 ring-surface"
          style={{ backgroundColor: STATUS_COLOR[customer.status] }}
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-lg leading-tight font-bold text-ink">{name}</span>
        {fresh ? (
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-sm font-bold text-accent">
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            New client
          </span>
        ) : (
          <span className="mt-0.5 block text-sm font-semibold text-muted">
            {invoiceCountLabel(money.invoiceCount)}
          </span>
        )}
      </span>

      <span className="flex shrink-0 flex-col items-end">
        <span className="text-lg leading-tight font-extrabold text-ink tabular-nums">
          {compactMoney(money.invoiced)}
        </span>
        <span
          className={`mt-0.5 text-sm font-semibold tabular-nums ${
            money.invoiced > 0 && money.paidPct === 100 ? "text-money" : "text-muted"
          }`}
        >
          {money.paidPct}% paid
        </span>
      </span>
    </Link>
  );
}

function RoundButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className={`tap-target relative flex size-12 shrink-0 items-center justify-center rounded-full border transition ${
        pressed
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-line bg-surface-2/80 text-ink backdrop-blur hover:bg-surface-3"
      }`}
    >
      {children}
    </button>
  );
}

function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.3" fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-muted" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth={2.2} />
      <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M8 4v16m0 0-3.5-3.5M8 20l3.5-3.5M16 20V4m0 0 3.5 3.5M16 4l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M4 7h16M7 12h10M10 17h4"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </svg>
  );
}
