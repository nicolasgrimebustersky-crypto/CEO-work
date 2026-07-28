"use client";

import { useEffect, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { addNote, changeStatus } from "@/lib/db/customers";
import { createQuote } from "@/lib/db/quotes";
import { formatMoney } from "@/lib/format";
import { SERVICE_LABEL } from "@/lib/status";
import { trySendSms } from "@/lib/smsClient";
import { SERVICE_TYPES } from "@/lib/types";
import type { Customer, ServiceType } from "@/lib/types";

/**
 * Records a quote and optionally texts it. A new quote also moves the customer
 * to "quoted" — that is what the status means, and keeping the two in sync by
 * hand is exactly the kind of thing that gets forgotten at a front door.
 */
export function QuoteSheet({
  customer,
  open,
  onClose,
}: {
  customer: Customer;
  open: boolean;
  onClose: () => void;
}) {
  const { author } = useTeam();
  const [serviceType, setServiceType] = useState<ServiceType>("pressure_washing");
  const [amount, setAmount] = useState("");
  const [alsoText, setAlsoText] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setServiceType(customer.serviceTypes[0] ?? "pressure_washing");
    setAmount("");
    setAlsoText(Boolean(customer.phone));
    setError(null);
    setWarning(null);
  }, [open, customer]);

  async function save() {
    if (!author) return;
    const value = Number.parseFloat(amount);
    if (Number.isNaN(value) || value <= 0) return setError("Enter a quote amount.");

    setSaving(true);
    setError(null);
    setWarning(null);

    let smsProblem: string | null = null;
    try {
      await createQuote({ customerId: customer.id, serviceType, amount: value }, author);

      await addNote(
        customer,
        `Quoted ${formatMoney(value)} for ${SERVICE_LABEL[serviceType].toLowerCase()}.`,
        "quote",
        author,
      );

      if (customer.status === "lead") {
        await changeStatus(customer, "quoted", author);
      }

      if (alsoText && customer.phone) {
        smsProblem = await trySendSms(
          customer.id,
          `Grime Busters: your quote for ${SERVICE_LABEL[serviceType].toLowerCase()} is ${formatMoney(value)}. Reply here to book it in.`,
          "quote",
        );
      }

      if (smsProblem) {
        setWarning(`Quote saved, but the text didn't send: ${smsProblem}`);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this quote.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      title="New quote"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button full onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save quote"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Service</p>
          <div className="flex flex-wrap gap-2">
            {SERVICE_TYPES.map((service) => (
              <Chip
                key={service}
                active={serviceType === service}
                onClick={() => setServiceType(service)}
              >
                {SERVICE_LABEL[service]}
              </Chip>
            ))}
          </div>
        </div>

        <TextField
          label="Amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="5"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Text the quote?</p>
          <div className="flex flex-wrap gap-2">
            <Chip
              active={alsoText}
              onClick={customer.phone ? () => setAlsoText(true) : undefined}
            >
              Send text
            </Chip>
            <Chip active={!alsoText} onClick={() => setAlsoText(false)}>
              Just record it
            </Chip>
          </div>
          {!customer.phone ? (
            <p className="mt-1.5 text-sm font-semibold text-muted">
              No phone number on file, so this can only be recorded.
            </p>
          ) : null}
        </div>

        <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm font-semibold text-muted">
          Mark a quote &ldquo;no response&rdquo; on this page to hand it to the automatic
          follow-up: a text every 4 days, 3 attempts, then it&apos;s marked declined.
        </p>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}

        {warning ? (
          <p
            role="alert"
            className="rounded-xl border border-warn/70 bg-warn/20 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {warning}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
