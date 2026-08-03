"use client";

import { useEffect, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { recordPayment } from "@/lib/db/documents";
import type { BusinessDocument } from "@/lib/documents";
import { formatMoneyExact } from "@/lib/format";
import { isoDate, parseDueDate, toNumber } from "./draft";

/** How money actually arrives for this business. Anything else is typed in. */
const METHODS = ["Cash", "Check", "Card", "Zelle", "Venmo"];

const INPUT =
  "tap-target w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

export function PaymentSheet({
  document,
  open,
  onClose,
}: {
  document: BusinessDocument;
  open: boolean;
  onClose: () => void;
}) {
  const { author } = useTeam();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState(() => isoDate(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefilled with what is still owed, which is the amount nine times in ten.
  useEffect(() => {
    if (open) {
      setAmount(document.balanceDue > 0 ? document.balanceDue.toFixed(2) : "");
      setError(null);
    }
  }, [open, document.balanceDue]);

  const value = toNumber(amount);
  const overpaying = value > document.balanceDue + 0.005;

  async function onSave() {
    if (!author || value <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const label = reference.trim() ? `${method} ${reference.trim()}` : method;
      await recordPayment(document, value, label, author, parseDueDate(receivedOn));
      setReference("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      title="Record a payment"
      onClose={onClose}
      footer={
        <Button full onClick={() => void onSave()} disabled={busy || value <= 0}>
          {busy ? "Saving…" : `Record ${formatMoneyExact(value)}`}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base font-semibold text-muted">
          Invoice {document.number} · {formatMoneyExact(document.balanceDue)} outstanding
        </p>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-muted">Amount</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Payment amount"
            className={INPUT}
          />
          {overpaying ? (
            <p className="mt-1.5 text-sm font-semibold text-warn">
              That is more than the balance. Fine if they tipped — just checking.
            </p>
          ) : null}
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-muted">How</span>
          <div className="flex flex-wrap gap-2">
            {METHODS.map((option) => (
              <Chip key={option} active={method === option} onClick={() => setMethod(option)}>
                {option}
              </Chip>
            ))}
          </div>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={method === "Check" ? "Check number" : "Reference (optional)"}
            aria-label="Payment reference"
            className={`${INPUT} mt-2`}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-muted">Received</span>
          <input
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            aria-label="Date received"
            className={INPUT}
          />
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
