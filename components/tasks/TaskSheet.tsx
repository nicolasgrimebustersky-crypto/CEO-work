"use client";

import { useEffect, useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useNotify } from "@/components/providers/NotificationsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { createTask, deleteTask, updateTask } from "@/lib/db/tasks";
import { customerName } from "@/lib/format";
import {
  DUE_PRESETS,
  dueFromInput,
  inputFromDue,
  presetDue,
  snoozed,
  taskProblem,
  type DuePreset,
} from "@/lib/tasks";
import type { Task } from "@/lib/types";

/** What a follow-up is about, when the screen that opened the sheet knows. */
export interface TaskContext {
  customerId: string;
  customerName: string;
  documentId?: string | null;
}

/**
 * Add or edit a follow-up.
 *
 * Built to be filled in with a thumb in about five seconds: type what, tap
 * when, done. Everything else — who, which client, notes — has a sensible
 * default (you; the client you are looking at; nothing).
 */
export function TaskSheet({
  open,
  onClose,
  task,
  context,
}: {
  open: boolean;
  onClose: () => void;
  /** Present to edit; absent to add. */
  task?: Task | null;
  /** Fixes the client: a follow-up added from a client's page is about them. */
  context?: TaskContext | null;
}) {
  const { author, users, nameFor } = useTeam();
  const { customers } = useCustomers();
  const notify = useNotify();

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState<Date | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [client, setClient] = useState<TaskContext | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Fresh each time it opens, from the task being edited or the defaults.
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setNotes(task?.notes ?? "");
    setDue(task ? (task.dueAt?.toDate() ?? null) : presetDue("tomorrow", Date.now()));
    setAssignee(task ? task.assignedTo : (author?.uid ?? null));
    setClient(
      task?.customerId
        ? { customerId: task.customerId, customerName: task.customerName ?? "", documentId: task.documentId }
        : (context ?? null),
    );
    setSearch("");
    setError("");
    setSaving(false);
  }, [open, task, context, author?.uid]);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length < 2) return [];
    return customers
      .filter((c) =>
        `${customerName(c)} ${c.address} ${c.phone}`.toLowerCase().includes(needle),
      )
      .slice(0, 5);
  }, [customers, search]);

  const now = Date.now();
  const dueKey = due ? inputFromDue(due.getTime()) : "";
  const activePreset = DUE_PRESETS.find(
    (preset) => inputFromDue(presetDue(preset.key, now).getTime()) === dueKey,
  )?.key;

  const save = async () => {
    if (!author) return;
    const problem = taskProblem({ title, notes });
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const fields = {
        title,
        notes,
        due,
        customerId: client?.customerId ?? null,
        customerName: client?.customerName ?? null,
        documentId: client?.documentId ?? null,
        assignedTo: assignee,
      };
      if (task) {
        // The date is only sent when it moved: sending it clears the reminder
        // stamp, and renaming a task is not a reason to buzz about it again.
        const dueChanged = (task.dueAt?.toMillis() ?? null) !== (due?.getTime() ?? null);
        await updateTask(task.id, { ...fields, due: dueChanged ? due : undefined }, author);
      } else {
        await createTask(fields, author);
      }
      // Handing somebody work is worth a buzz; writing yourself a note is not.
      const handedOver = assignee && assignee !== author.uid && assignee !== task?.assignedTo;
      if (handedOver) {
        void notify({
          type: "task_assigned",
          body: client?.customerName ? `${title.trim()} · ${client.customerName}` : title.trim(),
          customerId: client?.customerId ?? null,
          toUids: [assignee],
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the follow-up.");
      setSaving(false);
    }
  };

  const snooze = async (days: number) => {
    if (!author || !task) return;
    setSaving(true);
    try {
      await updateTask(task.id, { due: snoozed(task.dueAt?.toMillis() ?? null, days, Date.now()) }, author);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move it.");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    setSaving(true);
    try {
      await deleteTask(task.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete it.");
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      title={task ? "Follow-up" : "New follow-up"}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 pb-3">
          {error ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {error}
            </p>
          ) : null}
          <Button full onClick={save} disabled={saving || !author}>
            {saving ? "Saving…" : task ? "Save" : "Add follow-up"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <TextField
          label="What needs doing"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Call back about the gutter quote"
          maxLength={300}
          autoFocus={!task}
          enterKeyHint="done"
        />

        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">When</p>
          <div className="flex flex-wrap gap-2">
            {DUE_PRESETS.map((preset) => (
              <Chip
                key={preset.key}
                active={activePreset === preset.key}
                onClick={() => setDue(presetDue(preset.key as DuePreset, Date.now()))}
              >
                {preset.label}
              </Chip>
            ))}
            <Chip active={due === null} onClick={() => setDue(null)}>
              No date
            </Chip>
          </div>
          <div className="mt-3">
            <TextField
              label="Or pick a day"
              type="date"
              value={dueKey}
              onChange={(event) => setDue(dueFromInput(event.target.value))}
            />
          </div>
        </div>

        {users.length > 1 ? (
          <div>
            <p className="mb-1.5 text-sm font-semibold text-muted">Who</p>
            <div className="flex flex-wrap gap-2">
              {users.map((user) => (
                <Chip
                  key={user.uid}
                  active={(assignee ?? task?.createdBy ?? author?.uid) === user.uid}
                  onClick={() => setAssignee(user.uid)}
                >
                  {user.uid === author?.uid ? "Me" : nameFor(user.uid)}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Client</p>
          {client ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
              <span className="truncate font-bold text-ink">{client.customerName || "A client"}</span>
              {context ? null : (
                <button
                  type="button"
                  onClick={() => setClient(null)}
                  className="tap-target rounded-full px-3 text-sm font-bold text-muted hover:text-ink"
                >
                  Change
                </button>
              )}
            </div>
          ) : (
            <>
              <TextField
                label="Find a client (optional)"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, street or phone"
              />
              {matches.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {matches.map((customer) => (
                    <li key={customer.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setClient({ customerId: customer.id, customerName: customerName(customer) })
                        }
                        className="tap-target w-full rounded-xl px-3 py-2 text-left hover:bg-surface-2"
                      >
                        <span className="block font-bold text-ink">{customerName(customer)}</span>
                        {customer.address ? (
                          <span className="block truncate text-sm text-muted">{customer.address}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        <TextAreaField
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={2000}
          placeholder="Anything to remember when you call"
        />

        {task ? (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => snooze(1)} disabled={saving}>
              Snooze a day
            </Button>
            <Button variant="secondary" onClick={() => snooze(7)} disabled={saving}>
              A week
            </Button>
            <Button variant="ghost" className="text-danger" onClick={remove} disabled={saving}>
              Delete
            </Button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
