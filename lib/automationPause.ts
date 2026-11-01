/**
 * Pausing an automation without switching it off.
 *
 * The switch is a standing decision — "we do this". A pause is a short one —
 * "not right now" — that undoes itself: a rained-out week, a customer who
 * complained this morning, a price that is about to change. Forgetting to
 * switch something back on is the failure a pause exists to remove, which is
 * why every choice but one has an end.
 *
 * "Forever" is the exception, and it is still not the same as off: the screen
 * keeps saying "Paused" with a Resume button, so it reads as a hold somebody
 * placed rather than a sequence that was never wanted.
 *
 * Two fields, both optional on the stored row, so every row written before
 * this existed reads as not paused:
 *
 *   pausedUntil    a timestamp, or null
 *   pausedForever  true, or absent
 *
 * Pure and import-free, so the one rule that decides whether a cron run does
 * anything can be tested by running it.
 */

export const PAUSE_CHOICES = [
  { key: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { key: "1d", label: "1 day", ms: 24 * 60 * 60 * 1000 },
  { key: "3d", label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { key: "forever", label: "Forever", ms: null },
] as const;

export type PauseChoice = (typeof PAUSE_CHOICES)[number]["key"];

export interface PauseState {
  /** Epoch milliseconds the pause ends at, or null for no timed pause. */
  pausedUntilMs: number | null;
  pausedForever: boolean;
}

export const NOT_PAUSED: PauseState = { pausedUntilMs: null, pausedForever: false };

/**
 * Whether the automation should stay quiet at `nowMs`.
 *
 * A timed pause ends exactly at its timestamp: at `pausedUntilMs` itself the
 * automation is live again, so "1 day" from 9:00 is back for tomorrow's 9:00.
 */
export function isPaused(state: PauseState | null | undefined, nowMs: number): boolean {
  if (!state) return false;
  if (state.pausedForever) return true;
  return state.pausedUntilMs !== null && state.pausedUntilMs > nowMs;
}

/** The state a choice produces, starting now. Unknown keys pause nothing. */
export function pauseFor(choice: string, nowMs: number): PauseState {
  const found = PAUSE_CHOICES.find((option) => option.key === choice);
  if (!found) return NOT_PAUSED;
  if (found.ms === null) return { pausedUntilMs: null, pausedForever: true };
  return { pausedUntilMs: nowMs + found.ms, pausedForever: false };
}

/**
 * Read the two stored fields from anything shaped like a row.
 *
 * `pausedUntil` arrives as a Firestore Timestamp on both SDKs; anything with a
 * `toMillis()` is accepted, so this module never has to import either one.
 * A value that cannot be read is treated as no pause — the same direction as
 * a row written before pausing existed.
 */
export function readPause(data: { pausedUntil?: unknown; pausedForever?: unknown }): PauseState {
  const until = data.pausedUntil as { toMillis?: () => number } | null | undefined;
  const ms = until && typeof until.toMillis === "function" ? until.toMillis() : null;
  return {
    pausedUntilMs: typeof ms === "number" && Number.isFinite(ms) ? ms : null,
    pausedForever: data.pausedForever === true,
  };
}
