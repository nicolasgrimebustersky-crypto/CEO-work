"use client";

import { useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { createTerritory } from "@/lib/db/territories";
import { acresOf, boundaryProblem, formatAcres } from "@/lib/knock/territory";
import type { LatLng } from "@/lib/types";

/**
 * The controls for drawing a territory, docked at the bottom of the map.
 *
 * Tap-to-place rather than drag-to-draw. On a phone the map already owns the
 * drag gesture for panning, and freehand drawing means either fighting that or
 * a mode switch nobody discovers. Tapping corners is slower per shape and
 * enormously more reliable one-handed — and a territory follows streets, so it
 * is five or six corners, not a curve.
 *
 * Undo is the one control that must be there. Every shape drawn on a phone
 * involves a mis-tap.
 */
export function TerritoryDrawBar({
  boundary,
  onUndo,
  onClear,
  onCancel,
  onSaved,
}: {
  boundary: LatLng[];
  onUndo: () => void;
  onClear: () => void;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { author, users } = useTeam();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [assigned, setAssigned] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = boundaryProblem(boundary);
  const acres = acresOf(boundary);

  async function save() {
    if (!author || problem) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createTerritory(
        { name, boundary, assignedTo: assigned },
        author,
      );
      setNaming(false);
      setName("");
      onSaved(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that territory.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="pb-safe pointer-events-auto absolute inset-x-0 bottom-0 border-t border-line bg-surface/95 px-3 pt-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-ink">
              {boundary.length === 0
                ? "Tap the corners of the area"
                : `${boundary.length} corner${boundary.length === 1 ? "" : "s"}`}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-muted">
              {problem ?? `About ${formatAcres(acres)}. Tap Save when it looks right.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="tap-target shrink-0 rounded-full border border-line px-4 text-base font-semibold text-ink"
          >
            Cancel
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button
            variant="secondary"
            onClick={onUndo}
            disabled={boundary.length === 0}
          >
            Undo
          </Button>
          <Button
            variant="secondary"
            onClick={onClear}
            disabled={boundary.length === 0}
          >
            Clear
          </Button>
          <Button onClick={() => setNaming(true)} disabled={problem !== null}>
            Save
          </Button>
        </div>
      </div>

      <Sheet
        open={naming}
        title="Name this territory"
        onClose={() => setNaming(false)}
        footer={
          <Button full onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save territory"}
          </Button>
        }
      >
        <label className="block">
          <span className="mb-1 block text-base font-semibold text-ink">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ridgemoor / Oak Ridge"
            className="tap-target w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <span className="mt-1 block text-sm font-semibold text-muted">
            What you&apos;d call the area out loud. About {formatAcres(acres)}.
          </span>
        </label>

        <div className="mt-4">
          <span className="mb-1.5 block text-base font-semibold text-ink">
            Whose ground is it?
          </span>
          <div className="flex flex-wrap gap-2">
            {users.map((user) => (
              <Chip
                key={user.uid}
                active={assigned.includes(user.uid)}
                onClick={() =>
                  setAssigned(
                    assigned.includes(user.uid)
                      ? assigned.filter((uid) => uid !== user.uid)
                      : [...assigned, user.uid],
                  )
                }
              >
                {user.displayName}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-sm font-semibold text-muted">
            Leave it blank for unclaimed ground — it draws grey and either of you
            can pick it up.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}
      </Sheet>
    </>
  );
}
