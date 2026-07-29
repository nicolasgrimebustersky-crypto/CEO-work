"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { customerName } from "@/lib/format";
import { sendBlast, type BlastResult } from "@/lib/smsClient";
import type { Customer } from "@/lib/types";

const SEGMENT_CHARS = 160;

/**
 * Texts the group currently showing in the list — whatever the search box and
 * filters have narrowed it to. Reusing the list's own filtering is what makes
 * "everyone quoted in 40031" possible without a second query builder.
 */
export function BlastSheet({
  recipients,
  open,
  onClose,
}: {
  recipients: Customer[];
  open: boolean;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BlastResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setBody("");
    setError(null);
    setResult(null);
  }, [open]);

  // The route skips these too, but showing the real number up front stops
  // "why did only 6 of 9 send?" after the fact.
  const { sendable, skipped } = useMemo(() => {
    const ok: Customer[] = [];
    const no: { customer: Customer; reason: string }[] = [];
    for (const customer of recipients) {
      if (customer.status === "do_not_knock") {
        no.push({ customer, reason: "do not knock" });
      } else if (!customer.phone.trim()) {
        no.push({ customer, reason: "no phone" });
      } else {
        ok.push(customer);
      }
    }
    return { sendable: ok, skipped: no };
  }, [recipients]);

  async function send() {
    if (!body.trim() || sendable.length === 0) return;
    setSending(true);
    setError(null);
    try {
      setResult(await sendBlast(sendable.map((c) => c.id), body.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Blast failed.");
    } finally {
      setSending(false);
    }
  }

  const segments = Math.max(1, Math.ceil(body.length / SEGMENT_CHARS));

  return (
    <Sheet
      open={open}
      title="Text this group"
      onClose={onClose}
      footer={
        result ? (
          <Button full onClick={onClose}>
            Done
          </Button>
        ) : (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button
              full
              onClick={() => void send()}
              disabled={sending || !body.trim() || sendable.length === 0}
            >
              {sending ? "Sending…" : `Send to ${sendable.length}`}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <p className="text-lg font-black text-ink">
            Sent {result.sent} of {result.attempted}
          </p>
          {result.failed.length > 0 ? (
            <div>
              <p className="mb-2 text-base font-bold text-warn">
                {result.failed.length} didn&apos;t go through
              </p>
              <ul className="flex flex-col gap-1.5">
                {result.failed.map((failure) => (
                  <li
                    key={failure.customerId}
                    className="rounded-xl border border-line bg-surface-2 px-3 py-2"
                  >
                    <span className="block text-base font-bold text-ink">
                      {failure.name}
                    </span>
                    <span className="block text-sm font-semibold text-muted">
                      {failure.error}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
            <p className="text-base font-bold text-ink">
              {sendable.length} {sendable.length === 1 ? "recipient" : "recipients"}
            </p>
            <p className="text-sm font-semibold text-muted">
              {sendable
                .slice(0, 4)
                .map((customer) => customerName(customer))
                .join(", ")}
              {sendable.length > 4 ? ` and ${sendable.length - 4} more` : ""}
            </p>
            {skipped.length > 0 ? (
              <p className="mt-1.5 text-sm font-semibold text-warn">
                Skipping {skipped.length}:{" "}
                {skipped
                  .slice(0, 3)
                  .map((item) => `${customerName(item.customer)} (${item.reason})`)
                  .join(", ")}
                {skipped.length > 3 ? "…" : ""}
              </p>
            ) : null}
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={1600}
            placeholder="Snow's coming Thursday — we have driveway slots open…"
            className="w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />

          <p className="text-sm font-semibold text-muted">
            {body.length} characters · {segments}{" "}
            {segments === 1 ? "segment" : "segments"} each · about{" "}
            {Math.ceil((sendable.length * 1.1) / 60)} min to send
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
            Every message is logged to that customer&apos;s timeline under your name.
          </p>
        </div>
      )}
    </Sheet>
  );
}
