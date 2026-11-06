"use client";

import { useMemo, useState } from "react";

import { useTasks } from "@/components/providers/TasksProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Spinner } from "@/components/ui/Spinner";
import { groupTasks, isMine } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { TaskRow } from "./TaskRow";
import { TaskSheet } from "./TaskSheet";

type Scope = "mine" | "everyone";

const SECTIONS = [
  { key: "overdue", label: "Late", tone: "text-danger" },
  { key: "today", label: "Today", tone: "text-warn" },
  { key: "upcoming", label: "Coming up", tone: "text-muted" },
  { key: "someday", label: "No date", tone: "text-muted" },
] as const;

/**
 * Everything somebody has said they will do, in the order to do it.
 *
 * "Mine" by default: the question this screen answers is "what do I owe
 * people today", and the other person's list is one tap away for the day
 * somebody has to cover.
 */
export function TasksScreen() {
  const { tasks, loading, error } = useTasks();
  const { author } = useTeam();
  const [scope, setScope] = useState<Scope>("mine");
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [adding, setAdding] = useState(false);

  const now = Date.now();
  const visible = useMemo(
    () => (scope === "mine" ? tasks.filter((task) => isMine(task, author?.uid ?? null)) : tasks),
    [tasks, scope, author?.uid],
  );
  const groups = useMemo(() => groupTasks(visible, now), [visible, now]);
  const openCount = visible.length - groups.done.length;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <ScreenHeader
        title="Follow-ups"
        subtitle={
          openCount === 0
            ? "Nothing waiting on you"
            : `${openCount} open${groups.overdue.length ? ` · ${groups.overdue.length} late` : ""}`
        }
      >
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex gap-2" role="group" aria-label="Whose follow-ups">
            <Chip active={scope === "mine"} onClick={() => setScope("mine")}>
              Mine
            </Chip>
            <Chip active={scope === "everyone"} onClick={() => setScope("everyone")}>
              Everyone
            </Chip>
          </div>
          <Button onClick={() => setAdding(true)}>+ Add</Button>
        </div>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 py-4 pb-8">
          {error ? (
            <p role="alert" className="rounded-2xl bg-danger/10 p-3 text-sm font-semibold text-danger">
              {error}
            </p>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner label="Loading…" />
            </div>
          ) : openCount === 0 && groups.done.length === 0 ? (
            <div className="rounded-3xl border border-line bg-surface p-6 text-center">
              <p className="text-lg font-extrabold text-ink">No follow-ups yet</p>
              <p className="mt-1 text-base font-semibold text-muted">
                Add one here or from any client — &ldquo;call back Thursday&rdquo;, &ldquo;send
                the gutter quote&rdquo; — and it will remind you the morning it is due.
              </p>
            </div>
          ) : (
            SECTIONS.map((section) =>
              groups[section.key].length === 0 ? null : (
                <section key={section.key} className="rounded-3xl border border-line bg-surface">
                  <h2
                    className={`px-5 pt-4 pb-1 text-sm font-extrabold tracking-wide uppercase ${section.tone}`}
                  >
                    {section.label} · {groups[section.key].length}
                  </h2>
                  <ul className="px-2 pb-2">
                    {groups[section.key].map((task) => (
                      <TaskRow key={task.id} task={task} now={now} onOpen={setEditing} />
                    ))}
                  </ul>
                </section>
              ),
            )
          )}

          {groups.done.length > 0 ? (
            <section className="rounded-3xl border border-line bg-surface">
              <button
                type="button"
                onClick={() => setShowDone((value) => !value)}
                aria-expanded={showDone}
                className="tap-target flex w-full items-center justify-between px-5 py-3 text-sm font-extrabold tracking-wide text-muted uppercase"
              >
                <span>Done · {groups.done.length}</span>
                <span aria-hidden>{showDone ? "−" : "+"}</span>
              </button>
              {showDone ? (
                <ul className="px-2 pb-2">
                  {groups.done.slice(0, 50).map((task) => (
                    <TaskRow key={task.id} task={task} now={now} onOpen={setEditing} />
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      <TaskSheet open={adding} onClose={() => setAdding(false)} />
      <TaskSheet open={editing !== null} task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
