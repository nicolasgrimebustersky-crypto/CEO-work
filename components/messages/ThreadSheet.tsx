"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { customerName, formatPhone, formatTimestamp } from "@/lib/format";
import { routes } from "@/lib/routes";
import { sendSms } from "@/lib/smsClient";
import type { Thread } from "@/lib/threads";
import type { Customer } from "@/lib/types";

/** Single SMS segment; past this Twilio bills per additional segment. */
const SEGMENT_CHARS = 160;

/**
 * One conversation, read the way a conversation reads: oldest at the top, reply
 * box at the bottom in thumb reach.
 *
 * Sending goes through Twilio rather than handing off to the phone's own
 * messaging app. A text sent from the handset directly would be invisible to
 * the other crew member and would never reach this thread — the whole point of
 * routing it through the app is that both people can see the whole history.
 */
export function ThreadSheet({
  thread,
  customer,
  onClose,
}: {
  thread: Thread;
  customer: Customer;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Open on the newest message. Anything else means scrolling past weeks of
  // history to find the line you came to read.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.messages.length]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      await sendSms(customer.id, text);
      // The realtime listener puts it on the thread; clearing here rather than
      // closing keeps the conversation open for a second message.
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that text.");
    } finally {
      setSending(false);
    }
  }

  const segments = Math.max(1, Math.ceil(body.length / SEGMENT_CHARS));
  const blocked = customer.status === "do_not_knock";

  return (
    <Sheet
      open
      title={customerName(customer)}
      onClose={onClose}
      footer={
        blocked ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            This customer is marked do not knock. Change their status before
            texting them again.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Write a reply…"
              aria-label="Reply"
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-muted">
                {body.length} characters · {segments} segment
                {segments === 1 ? "" : "s"}
              </span>
              <Button
                onClick={() => void send()}
                disabled={sending || !body.trim() || !customer.phone}
              >
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
            {!customer.phone ? (
              <p className="text-sm font-semibold text-muted">
                No phone number on this customer, so there is nothing to send to.
              </p>
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
        )
      }
    >
      {/* Both are full tap targets, not inline text links. Everything in this
          app is used one-handed on a phone, and a 24px link is a miss. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {customer.phone ? (
          <a
            href={`tel:${customer.phone}`}
            className="tap-target inline-flex items-center rounded-xl border border-line bg-surface-2 px-3 text-base font-semibold text-accent"
          >
            {formatPhone(customer.phone)}
          </a>
        ) : null}
        <Link
          href={routes.customer(customer.id)}
          onClick={onClose}
          className="tap-target inline-flex items-center rounded-xl border border-line bg-surface-2 px-3 text-base font-semibold text-accent"
        >
          Open customer
        </Link>
      </div>

      <ol className="flex flex-col gap-2">
        {thread.messages.map((message) => {
          const inbound = message.direction === "in";
          return (
            <li
              key={message.id}
              className={`flex ${inbound ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2.5 ${
                  inbound
                    ? "rounded-bl-sm border border-line bg-surface-2"
                    : "rounded-br-sm border border-accent/40 bg-accent/15"
                }`}
              >
                <p className="text-base whitespace-pre-wrap text-ink">{message.text}</p>
                <p className="mt-1 text-sm font-semibold text-muted">
                  {inbound ? "Them" : message.authorName} ·{" "}
                  {formatTimestamp(message.at as never)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <div ref={endRef} />
    </Sheet>
  );
}
