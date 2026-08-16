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
 * Drag a loop around the area and let go. One finger, one gesture, the way you
 * would draw it on paper.
 *
 * The map already owns the drag for panning, so the two cannot both be live —
 * hence the Draw / Move map toggle, which is the whole cost of freehand and is
 * out in the open rather than hidden behind a long press. Move map hands the
 * gesture straight back without discarding the shape so far.
 *
 * A tap still adds a single corner. It is the fine adjustment a freehand loop
 * cannot make: nudging a boundary onto the far side of a cul-de-sac.
 *
 * Undo is the one control that must be there. Every shape drawn on a phone
 * involves a slip.
 */
export function TerritoryDrawBar({
  boundary,
  panning,
  canUndo,
  onPanningChange,
  onUndo,
  onClear,
  onCancel,
  onSaved,
}: {
  boundary: LatLng[];
  /** True while the map has its own gestures back. */
  panning: boolean;
  /** There is a previous shape to step back to. */
  canUndo: boolean;
  onPanningChange: (panning: boolean) => void;
  /** Steps back over a whole drag, or one tapped corner. */
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
      {/* z-20 puts this above the drawing sheet (z-10). Without it the sheet
          covers the bar and every control in here — including the toggle that
          turns the sheet off — is unclickable. */}
      <div className="pb-safe pointer-events-auto absolute inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-3 pt-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-ink">
              {boundary.length === 0
                ? "Drag a loop around the area"
                : `${boundary.length} point${boundary.length === 1 ? "" : "s"}`}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-muted">
              {panning && boundary.length === 0
                ? "Move and zoom the map to frame the area, then switch back to Draw."
                : (problem ??
                  `About ${formatAcres(acres)}. Tap Save when it looks right.`)}
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

        {/* Which one the finger means. Out in the open rather than a long
            press, because a gesture nobody can see is a gesture nobody finds —
            and getting it wrong either pans away from the shape or draws a
            scribble across the county. */}
        <div
          role="radiogroup"
          aria-label="What dragging does"
          className="mt-3 grid grid-cols-2 gap-1 rounded-full border border-line bg-surface-2 p-1"
        >
          {[
            { label: "Draw", value: false },
            { label: "Move map", value: true },
          ].map((mode) => (
            <button
              key={mode.label}
              type="button"
              role="radio"
              aria-checked={panning === mode.value}
              onClick={() => onPanningChange(mode.value)}
              className={`tap-target rounded-full px-4 text-base font-bold transition ${
                panning === mode.value
                  ? "bg-accent text-accent-ink"
                  : "bg-transparent text-ink"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <Button variant="secondary" onClick={onUndo} disabled={!canUndo}>
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
