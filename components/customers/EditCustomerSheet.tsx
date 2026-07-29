"use client";

import { useEffect, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { updateCustomer } from "@/lib/db/customers";
import { SERVICE_LABEL } from "@/lib/status";
import { SERVICE_TYPES } from "@/lib/types";
import type { Customer, ServiceType } from "@/lib/types";

export function EditCustomerSheet({
  customer,
  open,
  onClose,
}: {
  customer: Customer;
  open: boolean;
  onClose: () => void;
}) {
  const { author } = useTeam();
  const [firstName, setFirstName] = useState(customer.firstName);
  const [lastName, setLastName] = useState(customer.lastName);
  const [phone, setPhone] = useState(customer.phone);
  const [email, setEmail] = useState(customer.email);
  const [address, setAddress] = useState(customer.address);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>(customer.serviceTypes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the document each time the sheet opens, so a change the other
  // user made while this was closed isn't silently overwritten by stale state.
  useEffect(() => {
    if (!open) return;
    setFirstName(customer.firstName);
    setLastName(customer.lastName);
    setPhone(customer.phone);
    setEmail(customer.email);
    setAddress(customer.address);
    setServiceTypes(customer.serviceTypes);
    setError(null);
  }, [open, customer]);

  async function save() {
    if (!author) return;
    setSaving(true);
    setError(null);
    try {
      await updateCustomer(
        customer.id,
        { firstName, lastName, phone, email, address, serviceTypes },
        author,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      title="Edit contact"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button full onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoCapitalize="words"
          />
          <TextField
            label="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoCapitalize="words"
          />
        </div>
        <TextField
          label="Phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />

        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Services</p>
          <div className="flex flex-wrap gap-2">
            {SERVICE_TYPES.map((service) => (
              <Chip
                key={service}
                active={serviceTypes.includes(service)}
                onClick={() =>
                  setServiceTypes((current) =>
                    current.includes(service)
                      ? current.filter((s) => s !== service)
                      : [...current, service],
                  )
                }
              >
                {SERVICE_LABEL[service]}
              </Chip>
            ))}
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
