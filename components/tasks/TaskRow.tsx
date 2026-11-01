"use client";

import Link from "next/link";
import { useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { setTaskDone } from "@/lib/db/tasks";
import { routes } from "@/lib/routes";
import { dueLabel, dueTone, isMine } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { readableInkOn } from "@/lib/userColor";

const TONE_CLASS = {
  late: "text-danger",
  today: "text-warn",
  soon: "text-muted",
  none: "text-muted",
} as const;

/**
 * One follow-up: a round tick box, what to do, and when.
 *
 * The tick is its own target, separate from the row, so marking one done
 * standing in a driveway never opens the editor by accident — and opening it
 * never ticks it.
 */
export function TaskRow({
  task,
  now,
  onOpen,
  showCustomer = true,
}: {
  task: Task;
  now: number;
  onOpen: (task: Task) => void;
  showCustomer?: boolean;
}) {
  const { author, colorFor, nameFor } = useTeam();
  const [busy, setBusy] = useState(false);
  const done = task.doneAt !== null;
  const due = task.dueAt?.toMillis() ?? null;
  const tone = done ? "none" : dueTone(due, now);
  const owner = task.assignedTo || task.createdBy;
  const someoneElse = !isMine(task, author?.uid ?? null);

  const toggle = async () => {
    if (!author || busy) return;
    setBusy(true);
    try {
      await setTaskDone(task.id, !done, author);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={done}
        aria-label={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
        className="tap-target flex shrink-0 items-center justify-center rounded-full px-2"
      >
        <span
          aria-hidden
          className={`flex size-6 items-center justify-center rounded-full border-2 text-sm font-black transition ${
            done ? "border-money bg-money text-money-ink" : "border-muted text-transparent"
          }`}
        >
          ✓
        </span>
      </button>
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="min-w-0 flex-1 rounded-2xl px-1 py-2.5 text-left active:bg-surface-2"
      >
        <span
          className={`block text-base font-bold ${done ? "text-muted line-through" : "text-ink"}`}
        >
          {task.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
          {due !== null ? (
            <span className={TONE_CLASS[tone]}>{dueLabel(due, now)}</span>
          ) : (
            <span className="text-muted">No date</span>
          )}
          {showCustomer && task.customerName ? (
            <span className="truncate text-muted">· {task.customerName}</span>
          ) : null}
          {someoneElse ? (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ backgroundColor: colorFor(owner), color: readableInkOn(colorFor(owner)) }}
            >
              {nameFor(owner)}
            </span>
          ) : null}
        </span>
      </button>
      {showCustomer && task.customerId ? (
        <Link
          href={routes.customer(task.customerId)}
          aria-label={`Open ${task.customerName ?? "the client"}`}
          className="tap-target flex shrink-0 items-center rounded-full px-3 text-lg text-muted hover:text-ink"
        >
          ›
        </Link>
      ) : null}
    </li>
  );
}
