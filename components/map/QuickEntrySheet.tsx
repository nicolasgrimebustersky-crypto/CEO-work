"use client";

import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useNotify } from "@/components/providers/NotificationsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { createCustomer } from "@/lib/db/customers";
import { formatCoords } from "@/lib/geo";
import { reverseGeocode } from "@/lib/geocode";
import { routes } from "@/lib/routes";
import { SERVICE_SHORT_LABEL, STATUS_LABEL } from "@/lib/status";
import { CUSTOMER_STATUSES, SERVICE_TYPES } from "@/lib/types";
import type { CustomerStatus, LatLng, PropertyType, ServiceType } from "@/lib/types";
import { PropertyTypePicker } from "@/components/customers/PropertyTypePicker";
import { StatusPicker } from "@/components/customers/StatusPicker";
import { Glyph, PinMark, pinGlyphFor, QUOTE_GLYPH, SERVICE_GLYPH } from "./pinGlyphs";

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
 *
 * The pin at the top of the sheet is the pin that will land on the map,
 * drawn live from the status and service chosen below it. What you see is
 * what the map gets.
 *
 * Two ways out: save the pin, or save it and go straight to a blank estimate
 * for this house. The second is for the door where they said "how much?" —
 * the price gets written on the driveway with the house in front of you,
 * and the customer link is one more tap from there.
 */
export function QuickEntrySheet({ position, onClose, onCreated }: QuickEntrySheetProps) {
  const { author } = useTeam();
  const notify = useNotify();
  const router = useRouter();
  const geocodingLib = useMapsLibrary("geocoding");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<CustomerStatus>("lead");
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [note, setNote] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>("residential");
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const geocoder = useMemo(
    () => (geocodingLib ? new geocodingLib.Geocoder() : null),
    [geocodingLib],
  );

  // Reset and re-look-up whenever a new pin is dropped. `saving` is reset
  // here as well as after each save: this component stays mounted between
  // pins, so anything not cleared is what the next house starts with.
  useEffect(() => {
    if (!position) return;
    setFirstName("");
    setLastName("");
    setPhone("");
    setAddress("");
    setStatus("lead");
    setServiceTypes([]);
    setNote("");
    setPropertyType("residential");
    setError(null);
    setSaving(false);
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

  async function save(thenEstimate = false) {
    if (!position || !author || saving) return;
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
          propertyType,
        },
        author,
      );
      // The pin is on the map the moment the write lands. Telling the crew
      // is a second round trip — a notification record plus a push call —
      // and nobody standing at the next door should wait on it, so it runs
      // behind the closing sheet. `notify` swallows its own failures.
      void notify({
        type: "customer_added",
        body: `${[firstName, lastName].filter(Boolean).join(" ") || "New pin"} · ${address || "no address yet"} · ${STATUS_LABEL[status]}`,
        customerId: id,
      });
      onCreated(id);
      // The pin is saved either way; the estimate is just where the next
      // screen opens. A failed navigation cannot lose the pin.
      if (thenEstimate) router.push(routes.newDocument("estimate", id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this pin.");
    } finally {
      // Always. This component stays mounted between pins, and a flag left
      // true here is a Save button that never comes back for the next house.
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={position !== null}
      title="New pin"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="tap-target rounded-full border border-line bg-surface-2 px-5 text-base font-bold text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save(false)}
              disabled={saving || !author}
              className="gb-cta-accent tap-target flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-base font-extrabold tracking-wide text-accent-ink uppercase transition hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:shadow-none"
            >
              {saving ? "Saving…" : "Save pin"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void save(true)}
            disabled={saving || !author}
            className="tap-target flex h-12 w-full items-center justify-center gap-2 rounded-full border border-accent/50 bg-accent/10 text-base font-bold text-ink transition hover:bg-accent/15 disabled:opacity-50"
          >
            <Glyph path={QUOTE_GLYPH} className="size-5 text-accent" />
            Save and write an estimate
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Where. The pin preview is live: it is the exact mark that will
            land on the map once this is saved. */}
        <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface-2 p-3 pr-4">
          <div className="flex size-14 shrink-0 items-center justify-center">
            <PinMark status={status} glyph={pinGlyphFor(status)} className="size-12" />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="pin-address" className="sr-only">
              Address
            </label>
            <input
              id="pin-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={lookingUp ? "Looking up the address…" : "Street address"}
              className="w-full bg-transparent text-lg leading-tight font-bold text-ink placeholder:font-semibold placeholder:text-muted/80 focus:outline-none"
            />
            <p className="mt-0.5 text-sm font-semibold text-muted tabular-nums">
              {position ? formatCoords(position) : ""}
            </p>
          </div>
        </div>

        {/* House or business. The other sites of a commercial customer are
            added from the customer's own screen, not here: this sheet is for
            the door in front of you, and a second address is something you
            know back in the truck. */}
        <fieldset>
          <legend className="mb-2 text-sm font-bold text-muted">Property type</legend>
          <PropertyTypePicker value={propertyType} onChange={setPropertyType} />
        </fieldset>

        {/* Status: one tap, the same badge the map will draw. */}
        <fieldset>
          <legend className="mb-2 text-sm font-bold text-muted">Status</legend>
          <StatusPicker selected={[status]} onSelect={setStatus} />
        </fieldset>

        {/* What they want. */}
        <fieldset>
          <legend className="mb-2 text-sm font-bold text-muted">Interested in</legend>
          <div className="grid grid-cols-3 gap-2">
            {SERVICE_TYPES.map((service) => {
              const active = serviceTypes.includes(service);
              return (
                <button
                  key={service}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleService(service)}
                  className={`tap-target flex items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-sm font-bold transition ${
                    active
                      ? "border-accent bg-accent/15 text-ink"
                      : "border-line bg-surface text-muted hover:bg-surface-2"
                  }`}
                >
                  <Glyph
                    path={SERVICE_GLYPH[service]}
                    className={`size-5 shrink-0 ${active ? "text-accent" : ""}`}
                  />
                  <span>{SERVICE_SHORT_LABEL[service]}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

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

        <TextAreaField
          label="Notes"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Dog in yard, come back after 6…"
        />

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
