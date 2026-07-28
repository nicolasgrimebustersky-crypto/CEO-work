"use client";

import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { createCustomer } from "@/lib/db/customers";
import { formatCoords } from "@/lib/geo";
import { reverseGeocode } from "@/lib/geocode";
import { SERVICE_LABEL, STATUS_LABEL } from "@/lib/status";
import { CUSTOMER_STATUSES, SERVICE_TYPES } from "@/lib/types";
import type { CustomerStatus, LatLng, ServiceType } from "@/lib/types";

interface QuickEntrySheetProps {
  position: LatLng | null;
  onClose: () => void;
  onCreated: (customerId: string) => void;
}

/**
 * The form that opens when you tap a house. Optimised for standing on a
 * driveway: the address fills itself in, status is one tap, and nothing but a
 * status is actually required — you can save "black pin, do not knock" in two
 * taps and keep walking.
 */
export function QuickEntrySheet({ position, onClose, onCreated }: QuickEntrySheetProps) {
  const { author } = useTeam();
  const geocodingLib = useMapsLibrary("geocoding");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<CustomerStatus>("lead");
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [note, setNote] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const geocoder = useMemo(
    () => (geocodingLib ? new geocodingLib.Geocoder() : null),
    [geocodingLib],
  );

  // Reset and re-look-up whenever a new pin is dropped.
  useEffect(() => {
    if (!position) return;
    setFirstName("");
    setLastName("");
    setPhone("");
    setAddress("");
    setStatus("lead");
    setServiceTypes([]);
    setNote("");
    setError(null);
  }, [position]);

  useEffect(() => {
    if (!position || !geocoder) return;
    let cancelled = false;
    setLookingUp(true);
    void reverseGeocode(geocoder, position).then((found) => {
      if (cancelled) return;
      // Don't clobber something already typed while the lookup was in flight.
      setAddress((current) => (current ? current : found));
      setLookingUp(false);
    });
    return () => {
      cancelled = true;
    };
  }, [position, geocoder]);

  function toggleService(service: ServiceType) {
    setServiceTypes((current) =>
      current.includes(service)
        ? current.filter((s) => s !== service)
        : [...current, service],
    );
  }

  async function save() {
    if (!position || !author) return;
    setSaving(true);
    setError(null);
    try {
      const id = await createCustomer(
        {
          firstName,
          lastName,
          phone,
          email: "",
          address,
          lat: position.lat,
          lng: position.lng,
          status,
          serviceTypes,
          tags: [],
          note,
        },
        author,
      );
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this pin.");
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={position !== null}
      title="New pin"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button full onClick={save} disabled={saving || !author}>
            {saving ? "Saving…" : "Save pin"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Status</p>
          <div className="flex flex-wrap gap-2">
            {CUSTOMER_STATUSES.map((value) => (
              <Chip
                key={value}
                active={status === value}
                onClick={() => setStatus(value)}
              >
                {STATUS_LABEL[value]}
              </Chip>
            ))}
          </div>
        </div>

        <TextField
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={lookingUp ? "Looking up address…" : "Street address"}
          hint={position ? formatCoords(position) : undefined}
        />

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

        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Interested in</p>
          <div className="flex flex-wrap gap-2">
            {SERVICE_TYPES.map((service) => (
              <Chip
                key={service}
                active={serviceTypes.includes(service)}
                onClick={() => toggleService(service)}
              >
                {SERVICE_LABEL[service]}
              </Chip>
            ))}
          </div>
        </div>

        <TextAreaField
          label="Notes"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Dog in yard, come back after 6…"
        />

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

export function SelectStatusField({
  value,
  onChange,
}: {
  value: CustomerStatus;
  onChange: (status: CustomerStatus) => void;
}) {
  return (
    <SelectField
      label="Status"
      value={value}
      onChange={(e) => onChange(e.target.value as CustomerStatus)}
    >
      {CUSTOMER_STATUSES.map((status) => (
        <option key={status} value={status}>
          {STATUS_LABEL[status]}
        </option>
      ))}
    </SelectField>
  );
}
