"use client";

import { useTeam } from "@/components/providers/TeamProvider";
import { UserChip } from "@/components/ui/Chips";
import { formatTimestamp } from "@/lib/format";
import type { Note, NoteKind } from "@/lib/types";

const KIND_LABEL: Record<NoteKind, string> = {
  note: "Note",
  status_change: "Status",
  sms_out: "Text sent",
  sms_in: "Text received",
  quote: "Quote",
  job: "Job",
};

/**
 * One timeline per customer covering notes, status changes, quotes and every
 * SMS in and out. Each entry carries the author's name and colour so it's
 * obvious at a glance who logged what.
 */
export function NotesTimeline({ notes }: { notes: Note[] }) {
  const { colorFor } = useTeam();

  if (notes.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
        Nothing logged yet.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {notes.map((note) => (
        <li
          key={note.id}
          className="rounded-xl border border-line bg-surface-2 p-3"
          style={{ borderLeft: `4px solid ${colorFor(note.authorUid)}` }}
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <UserChip name={note.authorName} color={colorFor(note.authorUid)} />
            <span className="text-sm font-bold text-muted">{KIND_LABEL[note.kind]}</span>
          </div>
          <p className="text-base whitespace-pre-wrap text-ink">{note.text}</p>
          <p className="mt-1.5 text-sm font-semibold text-muted">
            {formatTimestamp(note.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}
