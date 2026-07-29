import { subDays } from "date-fns";

import type { Customer, CustomerStatus, ServiceType } from "./types";

export const CONTACT_RECENCY_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "within7", label: "Last 7 days" },
  { value: "within30", label: "Last 30 days" },
  { value: "stale30", label: "Not in 30+ days" },
  { value: "stale90", label: "Not in 90+ days" },
  { value: "never", label: "Never contacted" },
] as const;

export type ContactRecency = (typeof CONTACT_RECENCY_OPTIONS)[number]["value"];

export interface CustomerFilters {
  /** Empty means "all" for both of these — no filter chips selected. */
  statuses: CustomerStatus[];
  serviceTypes: ServiceType[];
  recency: ContactRecency;
  /** uid of whoever logged the pin, or null for anyone. */
  loggedBy: string | null;
}

export const EMPTY_FILTERS: CustomerFilters = {
  statuses: [],
  serviceTypes: [],
  recency: "any",
  loggedBy: null,
};

export function activeFilterCount(filters: CustomerFilters): number {
  return (
    (filters.statuses.length > 0 ? 1 : 0) +
    (filters.serviceTypes.length > 0 ? 1 : 0) +
    (filters.recency !== "any" ? 1 : 0) +
    (filters.loggedBy ? 1 : 0)
  );
}

function matchesRecency(customer: Customer, recency: ContactRecency, now: Date): boolean {
  if (recency === "any") return true;

  const contacted = customer.lastContactedAt?.toDate() ?? null;
  if (recency === "never") return contacted === null;
  if (contacted === null) {
    // Never-contacted records are not "stale" in a useful sense — they have
    // simply never been worked — so they only show under the "never" option.
    return false;
  }

  switch (recency) {
    case "within7":
      return contacted >= subDays(now, 7);
    case "within30":
      return contacted >= subDays(now, 30);
    case "stale30":
      return contacted < subDays(now, 30);
    case "stale90":
      return contacted < subDays(now, 90);
    default:
      return true;
  }
}

export function applyFilters(
  customers: Customer[],
  filters: CustomerFilters,
  now: Date = new Date(),
): Customer[] {
  return customers.filter((customer) => {
    if (filters.statuses.length > 0 && !filters.statuses.includes(customer.status)) {
      return false;
    }
    if (
      filters.serviceTypes.length > 0 &&
      !customer.serviceTypes.some((service) => filters.serviceTypes.includes(service))
    ) {
      return false;
    }
    if (filters.loggedBy && customer.createdBy !== filters.loggedBy) return false;
    if (!matchesRecency(customer, filters.recency, now)) return false;
    return true;
  });
}

export function searchCustomers(customers: Customer[], term: string): Customer[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return customers;

  return customers.filter((customer) => {
    const haystack = [
      customer.firstName,
      customer.lastName,
      customer.phone,
      customer.email,
      customer.address,
      ...customer.tags,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
