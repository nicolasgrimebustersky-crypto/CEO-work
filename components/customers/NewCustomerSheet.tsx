"use client";

import { useEffect, useState } from "react";

import { useNotify } from "@/components/providers/NotificationsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { customerEntryProblem, willGeocode } from "@/lib/customerEntry";
import { createCustomer } from "@/lib/db/customers";
import { SERVICE_LABEL, STATUS_LABEL } from "@/lib/status";
import { CUSTOMER_STATUSES, SERVICE_TYPES } from "@/lib/types";
import type { CustomerStatus, ServiceType } from "@/lib/types";

/**
 * Adding somebody by hand, with no pin.
 *
 * Until now the only way into the book was dropping a pin on the map, which is
 * right for knocking a street and wrong for everything else — a referral over
 * the phone, a number on a napkin, a neighbour who asked while you were loading
 * the truck. None of those have a location, and making somebody guess one puts
 * a wrong dot on the map permanently.
 *
 * So this saves with no coordinates. If an address was typed, the map geocodes
 * it on its own the next time it loads, and the pin lands where it belongs. The
 * line under the address field says so, because otherwise the first thing
 * somebody does is go looking for a pin that is not there yet and assume the
 * save failed.
 */
export function NewCustomerSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Given the new id, so the caller can open the record it just made. */
  onCreated?: (id: string) => void;
}) {
  const { author } = useTeam();
  const notify = useNotify();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<CustomerStatus>("lead");
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setStatus("lead");
    setServiceTypes([]);
    setNote("");
    setError(null);
  }, [open]);

  const entry = { firstName, lastName, phone, email, address };
  const problem = customerEntryProblem(entry);

  // A complaint about the form must not outlive the thing it was complaining
  // about. `error` is only ever a save failure or a rejected submit, and both
  // stop being true the moment somebody edits a field — leaving the old text on
  // screen tells them their fix did not work when it did.
  useEffect(() => {
    setError((current) => (current === null ? current : null));
  }, [firstName, lastName, phone, email, address]);

  function toggleService(service: ServiceType) {
    setServiceTypes((current) =>
      current.includes(service)
        ? current.filter((s) => s !== service)
        : [...current, service],
    );
  }

  async function save() {
    if (!author) return;
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = await createCustomer(
        {
          firstName,
          lastName,
          phone,
          email,
          address,
          // No pin. The map fills these in from the address on its own.
          lat: 0,
          lng: 0,
          status,
          serviceTypes,
          tags: [],
          note,
          // Not a door knock. Keeping that honest is what makes the reports
          // worth reading — otherwise every referral counts as a knock.
          source: "manual",
        },
        author,
      );
      await notify({
        type: "customer_added",
        body: `${[firstName, lastName].filter(Boolean).join(" ") || address || "New lead"} · added by hand · ${STATUS_LABEL[status]}`,
        customerId: id,
      });
      onCreated?.(id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      title="Add someone"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button full onClick={() => void save()} disabled={saving || !author}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Status</p>
          <div className="flex flex-wrap gap-2">
            {CUSTOMER_STATUSES.map((value) => (
              <Chip key={value} active={status === value} onClick={() => setStatus(value)}>
                {STATUS_LABEL[value]}
              </Chip>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
          />
          <TextField
            label="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
          />
        </div>

        <TextField
          label="Phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          placeholder="502-555-0100"
        />

        <TextField
          label="Email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        <div>
          <TextField
            label="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoComplete="street-address"
            placeholder="88 Ridgemoor Way, La Grange, KY"
          />
          <p className="mt-1.5 text-sm font-semibold text-muted">
            {willGeocode(entry)
              ? "They'll show up on the map on their own once it finds the address."
              : "Optional — without one they won't appear on the map."}
          </p>
        </div>

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
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Referred by Marta Oakley. Wants a quote before the frost."
        />

        {/* Shown as soon as it is true rather than after the button is pressed.
            Somebody typing a lead into a phone should not have to submit to
            find out what is missing. */}
        {problem && !error ? (
          <p className="text-sm font-semibold text-muted">{problem}</p>
        ) : null}

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
