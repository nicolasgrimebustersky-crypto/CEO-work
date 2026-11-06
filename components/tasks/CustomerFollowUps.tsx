"use client";

import { useMemo, useState } from "react";

import { useTasks } from "@/components/providers/TasksProvider";
import { Button } from "@/components/ui/Button";
import { groupTasks } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { TaskRow } from "./TaskRow";
import { TaskSheet, type TaskContext } from "./TaskSheet";

/**
 * The follow-ups about one client, on that client's page.
 *
 * Open ones only, soonest first. Finished ones are counted rather than listed
 * — the notes timeline is where the history of a client lives, and a page
 * already this long does not need a second one.
 */
export function CustomerFollowUps({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const { tasks } = useTasks();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const now = Date.now();
  const groups = useMemo(
    () => groupTasks(tasks.filter((task) => task.customerId === customerId), now),
    [tasks, customerId, now],
  );
  const open = [...groups.overdue, ...groups.today, ...groups.upcoming, ...groups.someday];
  const context = useMemo<TaskContext>(() => ({ customerId, customerName }), [customerId, customerName]);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Follow-ups</h2>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          + Follow-up
        </Button>
      </div>
      {open.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
          Nothing to follow up on
          {groups.done.length > 0 ? ` · ${groups.done.length} done` : ""}.
        </p>
      ) : (
        <ul className="rounded-xl border border-line bg-surface-2 px-1">
          {open.map((task) => (
            <TaskRow key={task.id} task={task} now={now} onOpen={setEditing} showCustomer={false} />
          ))}
        </ul>
      )}
      <TaskSheet open={adding} onClose={() => setAdding(false)} context={context} />
      <TaskSheet open={editing !== null} task={editing} onClose={() => setEditing(null)} />
    </section>
  );
}
