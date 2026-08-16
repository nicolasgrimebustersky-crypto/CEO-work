"use client";

import { useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { Sheet } from "@/components/ui/Sheet";
import { customerName, formatPhone } from "@/lib/format";

/**
 * Who is this for?
 *
 * Search rather than a long scroll: there are already ninety-odd customers and
 * the list only grows. Matching runs over name, address and phone digits,
 * because at a door you might only remember the street.
 */
export function CustomerPickerSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (customerId: string) => void;
}) {
  const { customers } = useCustomers();
  const [term, setTerm] = useState("");

  const results = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    const matched = customers.filter((customer) => {
      if (!needle) return true;
      const haystack =
        `${customer.firstName} ${customer.lastName} ${customer.address}`.toLowerCase();
      if (haystack.includes(needle)) return true;
      return digits.length >= 3 && customer.phone.replace(/\D/g, "").includes(digits);
    });
    return matched
      .sort((a, b) => customerName(a).localeCompare(customerName(b)))
      .slice(0, 60);
  }, [customers, term]);

  return (
    <Sheet open={open} title="Pick a customer" onClose={onClose}>
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Name, street or phone"
        aria-label="Search customers"
        className="tap-target w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />

      {results.length === 0 ? (
        <p className="mt-4 text-base font-semibold text-muted">
          Nobody matches that. Drop a pin on the map first, then come back.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {results.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(customer.id);
                  setTerm("");
                }}
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-left active:bg-surface-3"
              >
                <span className="block text-base font-bold text-ink">
                  {customerName(customer)}
                </span>
                <span className="block text-sm font-semibold text-muted">
                  {customer.address || "No address"}
                  {customer.phone ? ` · ${formatPhone(customer.phone)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
