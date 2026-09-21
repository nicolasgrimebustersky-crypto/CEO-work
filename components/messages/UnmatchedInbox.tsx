"use client";

import { useEffect, useMemo, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { createCustomer } from "@/lib/db/customers";
import { markHandled, subscribeUnmatched, type StoredUnmatched } from "@/lib/db/inboundSms";
import { formatRelative } from "@/lib/format";
import { formatPhone, groupUnmatched, suggestName, type UnmatchedThread } from "@/lib/inboundSms";

/**
 * Texts from numbers we don't have on file.
 *
 * These used to be dropped. The webhook looked the number up, found no
 * customer, wrote a line to the server log and returned 200 — so a lead texting
 * back from a handset we did not have on record, or off a yard sign, reached
 * nobody. This is the screen that ends that.
 *
 * It sits above the known threads rather than behind a tab because an unknown
 * number is the most urgent thing in an inbox, not the least: it is usually
 * somebody who is not yet a customer asking whether we want their money.
 *
 * Turning one into a customer is one tap. That is the whole point — the
 * alternative is copying a phone number across screens by hand, which is the
 * sort of thing that does not get done on a Tuesday afternoon.
 */
export function UnmatchedInbox() {
  const { author } = useTeam();
  const [messages, setMessages] = useState<StoredUnmatched[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    return subscribeUnmatched(setMessages, (err) =>
      setError(err.message || "Could not load messages from unknown numbers."),
    );
  }, []);

  const threads = useMemo(() => groupUnmatched(messages), [messages]);

  const addAsCustomer = async (thread: UnmatchedThread) => {
    if (!author || busy) return;
    setBusy(thread.key);
    setError("");
    try {
      // The first thing they said is worth keeping: it is usually the job.
      const first = thread.messages[0];
      const { firstName, lastName } = suggestName(first.body);

      const customerId = await createCustomer(
        {
          firstName: firstName || "New",
          lastName: lastName || `lead ${formatPhone(thread.from)}`,
          phone: thread.from,
          email: "",
          address: "",
          lat: 0,
          lng: 0,
          status: "lead",
          serviceTypes: [],
          tags: [],
          note: thread.messages.map((m) => `"${m.body}"`).join("\n\n"),
        },
        author,
      );

      // Every message from that number, not just the one tapped — they are all
      // the same conversation and it now lives on the customer's timeline.
      await Promise.all(
        thread.messages.map((message) => markHandled(message.id, author, customerId)),
      );
    } catch {
      setError("Could not create the customer. Check your signal and try again.");
    } finally {
      setBusy("");
    }
  };

  const dismiss = async (thread: UnmatchedThread) => {
    if (!author || busy) return;
    setBusy(thread.key);
    setError("");
    try {
      await Promise.all(thread.messages.map((message) => markHandled(message.id, author, null)));
    } catch {
      setError("Could not dismiss that. Check your signal and try again.");
    } finally {
      setBusy("");
    }
  };

  if (threads.length === 0 && !error) return null;

  return (
    <section className="mb-4">
      <h2 className="mb-2 text-base font-bold text-ink">
        From numbers we don&rsquo;t know
        {threads.length > 0 ? ` · ${threads.length}` : ""}
      </h2>

      {error ? (
        <p className="mb-2 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-sm font-semibold text-ink">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {threads.map((thread) => (
          <li
            key={thread.key}
            className="rounded-xl border border-line bg-surface-2 p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <a
                href={`tel:${thread.from}`}
                className="text-base font-bold text-ink underline underline-offset-2"
              >
                {formatPhone(thread.from)}
              </a>
              <span className="shrink-0 text-xs font-semibold text-muted">
                {formatRelative(thread.last.receivedAt)}
              </span>
            </div>

            {/* Every message, not a preview. There are rarely more than two and
                the first one is usually the job. */}
            <div className="mt-2 flex flex-col gap-1.5">
              {thread.messages.map((message) => (
                <p
                  key={message.id}
                  className="rounded-lg bg-surface px-2.5 py-2 text-sm font-semibold leading-relaxed text-ink"
                >
                  {message.body}
                </p>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                disabled={Boolean(busy) || !author}
                onClick={() => void addAsCustomer(thread)}
              >
                {busy === thread.key ? "Adding…" : "Add as customer"}
              </Button>
              <Button
                variant="ghost"
                className="flex-1"
                disabled={Boolean(busy) || !author}
                onClick={() => void dismiss(thread)}
              >
                Not a lead
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
