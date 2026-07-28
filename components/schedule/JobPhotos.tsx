"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { formatDateOnly } from "@/lib/format";
import { removeJobPhoto, uploadJobPhoto, type PhotoSlot } from "@/lib/db/photos";
import type { Job, Photo } from "@/lib/types";

/**
 * Before/after capture. The file input carries `capture="environment"`, so on a
 * phone this opens the rear camera directly instead of the photo picker —
 * that's the difference between two taps and six while standing in a driveway.
 */
function PhotoGroup({
  job,
  slot,
  label,
}: {
  job: Job;
  slot: PhotoSlot;
  label: string;
}) {
  const { author, colorFor } = useTeam();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photos = job[slot];

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0 || !author) return;
    setBusy(true);
    setError(null);
    try {
      // Sequential so each upload sees the previous one's array — a parallel
      // batch would each read the same stale list and overwrite each other.
      let current = job[slot];
      for (const file of Array.from(files)) {
        const photo = await uploadJobPhoto(job.id, slot, file, current, author);
        current = [...current, photo];
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onRemove(photo: Photo) {
    if (!author) return;
    setBusy(true);
    try {
      await removeJobPhoto(job.id, slot, photo, job[slot], author);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-base font-bold text-ink">
          {label} {photos.length > 0 ? `(${photos.length})` : ""}
        </h4>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="tap-target rounded-xl border border-line bg-surface-2 px-3 text-sm font-bold text-ink disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Take photo"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => void onPick(e.target.files)}
      />

      {photos.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2 px-3 py-3 text-sm font-semibold text-muted">
          No {label.toLowerCase()} photos yet.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <li
              key={photo.path}
              className="overflow-hidden rounded-xl border border-line bg-surface-2"
              style={{ borderLeft: `4px solid ${colorFor(photo.takenBy)}` }}
            >
              <div className="relative aspect-square">
                <Image
                  src={photo.url}
                  alt={`${label} photo by ${photo.takenByName}`}
                  fill
                  sizes="33vw"
                  className="object-cover"
                />
              </div>
              <div className="px-1.5 py-1">
                <p className="truncate text-[11px] font-bold text-muted">
                  {photo.takenByName}
                </p>
                <p className="text-[10px] font-semibold text-muted">
                  {formatDateOnly(photo.takenAt)}
                </p>
                <button
                  type="button"
                  onClick={() => void onRemove(photo)}
                  disabled={busy}
                  className="mt-0.5 text-[11px] font-bold text-danger disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2 text-sm font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function JobPhotos({ job }: { job: Job }) {
  return (
    <div className="flex flex-col gap-4">
      <PhotoGroup job={job} slot="beforePhotos" label="Before" />
      <PhotoGroup job={job} slot="afterPhotos" label="After" />
    </div>
  );
}
