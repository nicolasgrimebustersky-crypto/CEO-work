"use client";

import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useState } from "react";

import { OtherLocationsField } from "@/components/customers/OtherLocationsField";
import { PropertyTypePicker } from "@/components/customers/PropertyTypePicker";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { updateCustomer } from "@/lib/db/customers";
import { forwardGeocode } from "@/lib/geocode";
import { SERVICE_LABEL } from "@/lib/status";
import { SERVICE_TYPES } from "@/lib/types";
import type { Customer, CustomerLocation, PropertyType, ServiceType } from "@/lib/types";

interface EditCustomerSheetProps {
  customer: Customer;
  open: boolean;
  onClose: () => void;
}

/**
 * This sheet lives on the customer screen, which is nowhere near the map and
 * has no Google Maps context of its own — but the extra sites a commercial
 * customer types here have to be turned into coordinates somehow. So it brings
 * its own loader rather than asking every screen that shows the sheet to.
 *
 * Without a key it still opens and still saves. An address that could not be
 * geocoded is kept and navigated to as written text (lib/maps.ts), so a
 * missing key costs a map pin, never the address itself.
 */
export function EditCustomerSheet(props: EditCustomerSheetProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  if (!apiKey) return <EditCustomerForm {...props} />;
  return (
    <APIProvider apiKey={apiKey} libraries={["geocoding"]}>
      <EditCustomerForm {...props} />
    </APIProvider>
  );
}

function EditCustomerForm({ customer, open, onClose }: EditCustomerSheetProps) {
  const { author } = useTeam();
  const geocodingLib = useMapsLibrary("geocoding");
  const [firstName, setFirstName] = useState(customer.firstName);
  const [lastName, setLastName] = useState(customer.lastName);
  const [phone, setPhone] = useState(customer.phone);
  const [email, setEmail] = useState(customer.email);
  const [address, setAddress] = useState(customer.address);
  const [propertyType, setPropertyType] = useState<PropertyType>(customer.propertyType);
  const [sites, setSites] = useState<CustomerLocation[]>(customer.addresses);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>(customer.serviceTypes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const geocoder = useMemo(
    () => (geocodingLib ? new geocodingLib.Geocoder() : null),
    [geocodingLib],
  );

  // Re-seed from the document each time the sheet opens, so a change the other
  // user made while this was closed isn't silently overwritten by stale state.
  useEffect(() => {
    if (!open) return;
    setFirstName(customer.firstName);
    setLastName(customer.lastName);
    setPhone(customer.phone);
    setEmail(customer.email);
    setAddress(customer.address);
    setPropertyType(customer.propertyType);
    setSites(customer.addresses);
    setServiceTypes(customer.serviceTypes);
    setError(null);
  }, [open, customer]);

  /**
   * Switching to residential empties the extra sites on screen as well as on
   * write, so what you are about to save is what you can see. Switching back
   * does not bring them back — that is the warning the empty list gives you
   * before you press Save, rather than after.
   */
  function changePropertyType(next: PropertyType) {
    setPropertyType(next);
    if (next !== "commercial") setSites([]);
  }

  async function save() {
    if (!author) return;
    setSaving(true);
    setError(null);
    try {
      // Only the rows that need it: an untouched site keeps the coordinates it
      // was saved with, so opening and saving this sheet costs no lookups.
      const located = await Promise.all(
        sites.map(async (site) => {
          const written = site.address.trim();
          if (!written) return null;
          if (site.lat !== 0 || site.lng !== 0) return { ...site, address: written };
          const found = geocoder ? await forwardGeocode(geocoder, written) : null;
          // A site Google could not place is kept at 0,0 and navigates by its
          // written address instead. See lib/types.ts.
          return { address: written, lat: found?.lat ?? 0, lng: found?.lng ?? 0 };
        }),
      );

      await updateCustomer(
        customer.id,
        {
          firstName,
          lastName,
          phone,
          email,
          address,
          serviceTypes,
          propertyType,
          addresses: located.filter((site): site is CustomerLocation => site !== null),
        },
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

        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Property type</p>
          <PropertyTypePicker
            value={propertyType}
            onChange={changePropertyType}
            disabled={saving}
          />
        </div>

        <TextField
          label={propertyType === "commercial" ? "Main address" : "Address"}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />

        {/* The reason the property type exists. A house is one front door; a
            commercial customer is one contact with as many sites as they have.
            The main address above stays the pin on the map — these are the
            others, each with its own directions link on the customer's
            screen. */}
        {propertyType === "commercial" ? (
          <OtherLocationsField sites={sites} onChange={setSites} disabled={saving} />
        ) : null}
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
