"use client";

import { useMemo, useState } from "react";

import { useServices } from "@/components/providers/ServicesProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import {
  createService,
  deleteService,
  updateService,
  type SavedService,
} from "@/lib/db/services";
import { formatMoneyExact, formatRelative } from "@/lib/format";
import { SERVICE_LABEL } from "@/lib/status";
import { SERVICE_TYPES, type ServiceType } from "@/lib/types";
import { toNumber } from "./draft";

const INPUT =
  "tap-target w-full rounded-2xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

/**
 * The price book.
 *
 * It fills itself from the estimates you write, so this screen exists to fix
 * a price or retire a service you no longer sell — not to be filled in before
 * you can quote anything.
 */
export function ServicesScreen() {
  const { services, loading, error } = useServices();
  const [editing, setEditing] = useState<SavedService | null>(null);
  const [creating, setCreating] = useState(false);
  const [term, setTerm] = useState("");

  const results = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return services;
    return services.filter((service) =>
      `${service.name} ${service.description}`.toLowerCase().includes(needle),
    );
  }, [services, term]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Services" subtitle="Your prices and wording, saved as you quote">
        <div className="mt-3 flex gap-2">
          <Button full onClick={() => setCreating(true)}>
            Add a service
          </Button>
        </div>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search services"
          aria-label="Search services"
          className={`${INPUT} mt-3`}
        />
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl">
          {error ? (
            <p
              role="alert"
              className="rounded-2xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
            >
              {error}
            </p>
          ) : loading ? (
            <div className="flex justify-center py-10">
              <Spinner label="Loading…" />
            </div>
          ) : results.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface-2 px-3 py-6 text-center text-base font-semibold text-muted">
              {services.length === 0
                ? "Nothing saved yet. Write an estimate and every service on it lands here automatically."
                : "Nothing matches that."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.map((service) => (
                <li key={service.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(service)}
                    className="w-full rounded-2xl border border-line bg-surface-2 p-3 text-left active:bg-surface-3"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-base font-bold break-words text-ink">
                          {service.name}
                        </span>
                        {service.description ? (
                          <span className="mt-0.5 block text-sm font-semibold break-words text-muted">
                            {service.description}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-xs font-bold tracking-wide text-muted uppercase">
                          {SERVICE_LABEL[service.serviceType]}
                          {service.taxable ? "" : " · no tax"}
                          {service.timesUsed > 0
                            ? ` · ${service.timesUsed}× · last ${formatRelative(service.lastUsedAt)}`
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
        </div>
      </div>

      <ServiceSheet
        service={editing}
        open={editing !== null || creating}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
      />
    </div>
  );
}

function ServiceSheet({
  service,
  open,
  onClose,
}: {
  service: SavedService | null;
  open: boolean;
  onClose: () => void;
}) {
  const { author } = useTeam();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [serviceType, setServiceType] = useState<ServiceType>("pressure_washing");
  const [taxable, setTaxable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyed on the service so reopening the sheet reloads its values rather than
  // showing whatever was typed the last time it was open.
  const key = service?.id ?? "new";
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setName(service?.name ?? "");
    setDescription(service?.description ?? "");
    setPrice(service ? String(service.unitPrice) : "");
    setServiceType(service?.serviceType ?? "pressure_washing");
    setTaxable(service?.taxable ?? true);
    setConfirmDelete(false);
    setError(null);
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  async function save() {
    if (!author || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const fields = {
        name: name.trim(),
        description: description.trim(),
        unitPrice: toNumber(price),
        serviceType,
        taxable,
      };
      if (service) await updateService(service.id, fields, author);
      else await createService(fields, author);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!service) return;
    setBusy(true);
    try {
      await deleteService(service.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that.");
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      title={service ? service.name : "New service"}
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          {service ? (
            <Button
              variant={confirmDelete ? "danger" : "secondary"}
              onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
              disabled={busy}
            >
              {confirmDelete ? "Sure?" : "Delete"}
            </Button>
          ) : null}
          <Button full onClick={() => void save()} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-muted">Service</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="House wash"
            aria-label="Service name"
            className={INPUT}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-muted">
            What it covers
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="The customer reads this on the estimate."
            aria-label="Service description"
            className={`${INPUT} resize-y`}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-muted">Usual price</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Usual price"
            className={INPUT}
          />
          <p className="mt-1.5 text-sm font-semibold text-muted">
            A starting point — you can change it on any estimate without changing it
            here.
          </p>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-muted">Kind of work</span>
          <div className="flex flex-wrap gap-2">
            {SERVICE_TYPES.map((option) => (
              <Chip
                key={option}
                active={serviceType === option}
                onClick={() => setServiceType(option)}
              >
                {SERVICE_LABEL[option]}
              </Chip>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-base font-semibold text-muted">
          <input
            type="checkbox"
            checked={taxable}
            onChange={(e) => setTaxable(e.target.checked)}
            className="size-5 accent-[var(--color-accent)]"
          />
          Sales tax applies
        </label>

        {error ? (
          <p
            role="alert"
            className="rounded-2xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
