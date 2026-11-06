"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useTasks } from "@/components/providers/TasksProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { routes } from "@/lib/routes";
import { dueNow, groupTasks, isMine } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { TaskRow } from "./TaskRow";
import { TaskSheet } from "./TaskSheet";

/**
 * Your follow-ups due today or already late, on the first screen of the day.
 *
 * Yours only: the dashboard answers "what do I have to do", and a list of the
 * other person's calls is noise at seven in the morning. Hidden entirely when
 * there are none and none have ever been written, so a crew that never uses
 * follow-ups never sees an empty card about them.
 */
export function DashboardFollowUps() {
  const { tasks } = useTasks();
  const { author } = useTeam();
  const [editing, setEditing] = useState<Task | null>(null);

  const now = Date.now();
  const mine = useMemo(
    () => tasks.filter((task) => isMine(task, author?.uid ?? null)),
    [tasks, author?.uid],
  );
  const due = useMemo(() => {
    const groups = groupTasks(dueNow(mine, now), now);
    return [...groups.overdue, ...groups.today];
  }, [mine, now]);

  if (tasks.length === 0) return null;
  const shown = due.slice(0, 5);

  return (
    <section className="rounded-3xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
        <h2 className="text-lg font-extrabold text-ink">
          Follow-ups{due.length > 0 ? ` · ${due.length}` : ""}
        </h2>
        <Link
          href={routes.tasks}
          className="tap-target -mr-2 inline-flex items-center rounded-full px-3 text-sm font-bold text-accent"
        >
          All →
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="px-5 pb-5 text-base font-semibold text-muted">
          Nothing due today. You&apos;re caught up.
        </p>
      ) : (
        <ul className="px-2 pb-2">
          {shown.map((task) => (
            <TaskRow key={task.id} task={task} now={now} onOpen={setEditing} />
          ))}
          {due.length > shown.length ? (
            <li className="px-3 py-2 text-sm font-bold text-muted">
              <Link href={routes.tasks}>And {due.length - shown.length} more →</Link>
            </li>
          ) : null}
        </ul>
      )}
      <TaskSheet open={editing !== null} task={editing} onClose={() => setEditing(null)} />
    </section>
  );
}
