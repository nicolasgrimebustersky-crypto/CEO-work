"use client";

import { useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Chip } from "@/components/ui/Chips";
import { Spinner } from "@/components/ui/Spinner";
import { customerName, formatRelative } from "@/lib/format";
import { buildThreads, needsReplyCount, previewOf, type Thread } from "@/lib/threads";
import type { Customer } from "@/lib/types";
import { ThreadSheet } from "./ThreadSheet";

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
  const [onlyUnanswered, setOnlyUnanswered] = useState(true);
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
          <Chip active={onlyUnanswered} onClick={() => setOnlyUnanswered(true)}>
            Needs reply{waiting > 0 ? ` · ${waiting}` : ""}
          </Chip>
          <Chip active={!onlyUnanswered} onClick={() => setOnlyUnanswered(false)}>
            All{threads.length > 0 ? ` · ${threads.length}` : ""}
          </Chip>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
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
      </div>

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
