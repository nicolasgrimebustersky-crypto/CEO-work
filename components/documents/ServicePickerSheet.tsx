"use client";

import { useMemo, useState } from "react";

import { useServices } from "@/components/providers/ServicesProvider";
import { Sheet } from "@/components/ui/Sheet";
import type { SavedService } from "@/lib/db/services";
import { formatMoneyExact } from "@/lib/format";
import { SERVICE_LABEL } from "@/lib/status";

/**
 * Pick a service you have quoted before.
 *
 * Ordered by how often you use it, so the house wash you sell twice a week is
 * the first thing under your thumb. Nothing here has to be filled in first —
 * the list builds itself out of the estimates you write.
 */
export function ServicePickerSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (service: SavedService) => void;
}) {
  const { services, loading } = useServices();
  const [term, setTerm] = useState("");

  const results = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return services;
    return services.filter((service) =>
      `${service.name} ${service.description}`.toLowerCase().includes(needle),
    );
  }, [services, term]);

  return (
    <Sheet open={open} title="Your services" onClose={onClose}>
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search your services"
        aria-label="Search saved services"
        className="tap-target w-full rounded-2xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />

      {loading ? (
        <p className="mt-4 text-base font-semibold text-muted">Loading…</p>
      ) : services.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
          Nothing saved yet. Type a service onto an estimate and it lands here
          automatically — price, wording and all — ready for the next one.
        </p>
      ) : results.length === 0 ? (
        <p className="mt-4 text-base font-semibold text-muted">Nothing matches that.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {results.map((service) => (
            <li key={service.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(service);
                  setTerm("");
                }}
                className="w-full rounded-2xl border border-line bg-surface-2 px-3 py-3 text-left active:bg-surface-3"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-base font-bold text-ink">{service.name}</span>
                    {service.description ? (
                      <span className="mt-0.5 block text-sm font-semibold text-muted">
                        {service.description}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-xs font-bold tracking-wide text-muted uppercase">
                      {SERVICE_LABEL[service.serviceType]}
                      {service.timesUsed > 0
                        ? ` · used ${service.timesUsed}×`
                        : " · not used yet"}
                    </span>
                  </span>
                  <span className="shrink-0 text-base font-extrabold text-money tabular-nums">
                    {formatMoneyExact(service.unitPrice)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
