"use client";

import { useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import {
  addItem,
  fromSteps,
  progress,
  removeItem,
  templateSteps,
  toggleItem,
  type ChecklistItem,
} from "@/lib/checklists";
import { setJobChecklist } from "@/lib/db/jobs";
import type { Job } from "@/lib/types";

/**
 * The job's checklist, ticked on site.
 *
 * Every tick is saved straight away: the list is for somebody holding a
 * wand in one hand, and a Save button they have to remember at the end is a
 * list that never gets saved.
 */
export function JobChecklist({ job }: { job: Job }) {
  const { author, nameFor } = useTeam();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  const list = job.checklist;
  const { done, total } = progress(list);

  const save = async (next: ChecklistItem[]) => {
    if (!author) return;
    setError("");
    try {
      await setJobChecklist(job.id, next, author);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the checklist.");
    }
  };

  const add = () => {
    if (!draft.trim()) return;
    void save(addItem(list, draft));
    setDraft("");
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted">
          Checklist{total > 0 ? ` · ${done} of ${total}` : ""}
        </p>
        {total > 0 ? (
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            className="tap-target rounded-full px-3 text-sm font-bold text-accent"
          >
            {editing ? "Done editing" : "Edit"}
          </button>
        ) : null}
      </div>

      {total > 0 ? (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <div
            className="h-full rounded-full bg-money transition-all"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
      ) : null}

      {total === 0 ? (
        <Button
          variant="secondary"
          full
          onClick={() => void save(fromSteps(templateSteps(job)))}
          disabled={!author}
        >
          Add the usual checklist
        </Button>
      ) : (
        <ul className="flex flex-col">
          {list.map((item) => (
            <li key={item.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => author && void save(toggleItem(list, item.id, author.uid, Date.now()))}
                aria-pressed={item.done}
                className="tap-target flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left active:bg-surface-2"
              >
                <span
                  aria-hidden
                  className={`flex size-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-black ${
                    item.done ? "border-money bg-money text-money-ink" : "border-muted text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-base font-semibold ${item.done ? "text-muted line-through" : "text-ink"}`}
                  >
                    {item.text}
                  </span>
                  {item.done && item.doneBy ? (
                    <span className="block text-xs font-semibold text-muted">{nameFor(item.doneBy)}</span>
                  ) : null}
                </span>
              </button>
              {editing ? (
                <button
                  type="button"
                  onClick={() => void save(removeItem(list, item.id))}
                  aria-label={`Remove "${item.text}"`}
                  className="tap-target shrink-0 rounded-full px-3 text-xl leading-none text-muted hover:text-danger"
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {total > 0 ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a step"
            maxLength={200}
            aria-label="Add a step"
            className="tap-target min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <Button type="submit" variant="secondary" disabled={!draft.trim()}>
            Add
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
