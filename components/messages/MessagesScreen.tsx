"use client";

import { useEffect, useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Chip } from "@/components/ui/Chips";
import { Spinner } from "@/components/ui/Spinner";
import { customerName, formatRelative } from "@/lib/format";
import { subscribeUnmatched, type StoredUnmatched } from "@/lib/db/inboundSms";
import { formatPhone } from "@/lib/inboundSms";
import {
  buildThreads,
  incomingFeed,
  needsReplyCount,
  previewOf,
  type Thread,
} from "@/lib/threads";
import type { Customer } from "@/lib/types";
import { ImportReplies } from "./ImportReplies";
import { ThreadSheet } from "./ThreadSheet";
import { UnmatchedInbox } from "./UnmatchedInbox";

/**
 * Every text conversation in one place.
 *
 * Texts were already logged to each customer's timeline, which made the
 * timeline a complete record and made the messages themselves invisible — to
 * see whether anybody had replied you had to already know whose record to open.
 * A customer who answers and hears nothing for six hours has usually called
 * somebody else by then.
 *
 * Opens on "Needs reply" rather than on everything, because that is the list
 * with a clock on it. The rest is history and can wait for a tap.
 */
export function MessagesScreen() {
  const { customers, loading } = useCustomers();
  const [view, setView] = useState<"needs_reply" | "all" | "incoming">("needs_reply");
  const onlyUnanswered = view === "needs_reply";
  const [openThread, setOpenThread] = useState<{
    thread: Thread;
    customer: Customer;
  } | null>(null);

  const threads = useMemo(() => buildThreads(customers), [customers]);
  const waiting = needsReplyCount(threads);
  const shown = onlyUnanswered ? threads.filter((t) => t.needsReply) : threads;

  // Threads are keyed by customer id, so a deleted customer drops out rather
  // than rendering a row with no name on it.
  const rows = shown
    .map((thread) => ({
      thread,
      customer: customers.find((c) => c.id === thread.customerId) ?? null,
    }))
    .filter((row): row is { thread: Thread; customer: Customer } => row.customer !== null);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Messages" />

      <div className="border-b border-line px-4 pb-3">
        <div className="flex flex-wrap gap-2">
          <Chip active={view === "needs_reply"} onClick={() => setView("needs_reply")}>
            Needs reply{waiting > 0 ? ` · ${waiting}` : ""}
          </Chip>
          <Chip active={view === "all"} onClick={() => setView("all")}>
            All{threads.length > 0 ? ` · ${threads.length}` : ""}
          </Chip>
          <Chip active={view === "incoming"} onClick={() => setView("incoming")}>
            Incoming
          </Chip>
        </div>
      </div>

      {view === "incoming" ? (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <IncomingList
            customers={customers}
            threads={threads}
            onOpen={(thread, customer) => setOpenThread({ thread, customer })}
          />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Above the known threads on purpose. An unknown number is usually
            somebody who is not a customer yet asking whether we want their
            money, which makes it the most urgent thing on the screen. It
            renders nothing at all when there is nothing waiting. */}
        <UnmatchedInbox />

        {loading && threads.length === 0 ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
            {onlyUnanswered
              ? threads.length > 0
                ? "Nobody's waiting on you. Tap All to read back through the rest."
                : "No texts yet. Send one from any customer and the conversation shows up here."
              : "No texts yet. Send one from any customer and the conversation shows up here."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map(({ thread, customer }) => (
              <li key={thread.customerId}>
                <button
                  type="button"
                  onClick={() => setOpenThread({ thread, customer })}
                  className={`tap-target w-full rounded-xl border p-3 text-left ${
                    thread.needsReply
                      ? "border-accent/60 bg-surface-2"
                      : "border-line bg-surface-2"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-base font-bold text-ink">
                          {customerName(customer)}
                        </span>
                        {thread.needsReply ? (
                          <span
                            className="size-2.5 shrink-0 rounded-full bg-accent"
                            aria-label="Waiting on a reply"
                          />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-base text-muted">
                        {previewOf(thread)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-muted">
                      {formatRelative(thread.last.at as never)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        <ImportReplies />
      </div>
      )}

      {openThread ? (
        <ThreadSheet
          thread={openThread.thread}
          customer={openThread.customer}
          onClose={() => setOpenThread(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Every text that came in, newest first — client replies and unknown numbers
 * together. The other two tabs are grouped by person; this one is the plain
 * list of what arrived, for "did anybody text today?".
 *
 * Tapping a client's text opens that conversation. A text from a number not on
 * file has no conversation yet; it is dealt with from the list on the other
 * tabs, where it can be turned into a client.
 */
function IncomingList({
  customers,
  threads,
  onOpen,
}: {
  customers: Customer[];
  threads: Thread[];
  onOpen: (thread: Thread, customer: Customer) => void;
}) {
  const [unmatched, setUnmatched] = useState<StoredUnmatched[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribeUnmatched(setUnmatched, (err) =>
      setError(err.message || "Could not load texts from unknown numbers."),
    );
  }, []);

  const feed = useMemo(() => incomingFeed(customers, unmatched), [customers, unmatched]);

  if (error) {
    return (
      <p className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-sm font-semibold text-ink">
        {error}
      </p>
    );
  }

  if (feed.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
        No texts have come in yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {feed.map((item) => {
        const customer = item.customerId
          ? (customers.find((c) => c.id === item.customerId) ?? null)
          : null;
        const thread = customer
          ? (threads.find((t) => t.customerId === customer.id) ?? null)
          : null;
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-base font-bold text-ink">
                {customer ? customerName(customer) : formatPhone(item.from)}
                {customer ? null : (
                  <span className="ml-2 text-sm font-semibold text-muted">not on file</span>
                )}
              </span>
              <span className="shrink-0 text-sm font-semibold text-muted">
                {formatRelative(item.at as never)}
              </span>
            </div>
            <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-base text-ink">
              {item.text}
            </p>
          </>
        );
        return (
          <li key={item.key}>
            {customer && thread ? (
              <button
                type="button"
                onClick={() => onOpen(thread, customer)}
                className="tap-target w-full rounded-xl border border-line bg-surface-2 p-3 text-left"
              >
                {body}
              </button>
            ) : (
              <div className="rounded-xl border border-line bg-surface-2 p-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
