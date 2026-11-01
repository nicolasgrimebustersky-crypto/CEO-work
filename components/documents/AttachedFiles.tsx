"use client";

import { attachmentBadge, attachmentTitle } from "@/lib/documents";

export interface FileTile {
  id: string;
  name: string;
  contentType: string;
}

/**
 * Attached files as tiles: a paper with a badge, the title, and what tapping
 * it does. The same tiles on the crew's screen and on the customer's copy, so
 * the crew sees exactly what the customer will.
 */
export function AttachedFiles({
  files,
  hrefFor,
  action = "Download",
  onRemove,
  onOpen,
  busyId,
}: {
  files: FileTile[];
  /** Where tapping a tile goes. Null renders a tile that does nothing. */
  hrefFor: (file: FileTile) => string | null;
  action?: string;
  /** Shown as a small Remove under each tile when given. */
  onRemove?: (file: FileTile) => void;
  /** For tiles that need work before opening — the crew's own copy. */
  onOpen?: (file: FileTile) => void;
  busyId?: string | null;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {files.map((file) => {
        const href = hrefFor(file);
        const tile = (
          <>
            <span className="relative block h-24 rounded-2xl border border-line bg-surface-2">
              {/* The folded corner. */}
              <span className="absolute top-0 right-0 size-6 rounded-tr-2xl rounded-bl-xl bg-surface-3" />
              <span className="absolute top-3 left-3 rounded-md border-2 border-danger px-1.5 text-xs font-extrabold text-danger">
                {attachmentBadge(file.contentType, file.name)}
              </span>
              <span className="absolute right-3 bottom-4 left-3 flex flex-col gap-1.5">
                <span className="h-1 w-3/4 rounded bg-line" />
                <span className="h-1 w-full rounded bg-line" />
                <span className="h-1 w-2/3 rounded bg-line" />
              </span>
            </span>
            <span className="mt-1.5 block truncate text-base font-bold text-ink">
              {attachmentTitle(file.name)}
            </span>
            <span className="block text-sm font-semibold text-accent">{action}</span>
          </>
        );
        return (
          <li key={file.id} className="min-w-0">
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="block">
                {tile}
              </a>
            ) : onOpen ? (
              <button type="button" onClick={() => onOpen(file)} className="block w-full text-left">
                {tile}
              </button>
            ) : (
              <div>{tile}</div>
            )}
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(file)}
                disabled={busyId === file.id}
                className="mt-0.5 text-sm font-semibold text-danger disabled:opacity-50"
              >
                {busyId === file.id ? "Removing…" : "Remove"}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
