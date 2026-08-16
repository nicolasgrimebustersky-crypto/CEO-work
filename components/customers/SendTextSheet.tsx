"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { customerName, formatPhone } from "@/lib/format";
import { sendSms } from "@/lib/smsClient";
import type { Customer } from "@/lib/types";

/** Single SMS segment; past this Twilio bills per additional segment. */
const SEGMENT_CHARS = 160;

/**
 * Sends through Twilio rather than handing off to the phone's messaging app,
 * so the message lands in the customer's notes timeline stamped with whoever
 * sent it. A text sent from the phone directly would be invisible to the other
 * crew member.
 */
export function SendTextSheet({
  customer,
  open,
  onClose,
  /** Prefilled text, e.g. the "here is your estimate" line. Still editable. */
  initialBody = "",
}: {
  customer: Customer;
  open: boolean;
  onClose: () => void;
  initialBody?: string;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBody(initialBody);
    setError(null);
  }, [open, initialBody]);

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendSms(customer.id, body.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that text.");
    } finally {
      setSending(false);
    }
  }

  const segments = Math.max(1, Math.ceil(body.length / SEGMENT_CHARS));

  return (
    <Sheet
      open={open}
      title={`Text ${customerName(customer)}`}
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button full onClick={() => void send()} disabled={sending || !body.trim()}>
            {sending ? "Sending…" : "Send text"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-base font-semibold text-muted">
          To {formatPhone(customer.phone)}
        </p>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={1600}
          placeholder="Hey, we're running about 20 minutes behind…"
          className="w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />

        <p className="text-sm font-semibold text-muted">
          {body.length} characters · {segments} {segments === 1 ? "segment" : "segments"}
        </p>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}

        <p className="text-sm font-semibold text-muted">
          Sent messages are logged to this customer&apos;s timeline with your name.
        </p>
      </div>
    </Sheet>
  );
}
