import type { AppUser } from "./types";

/**
 * Two accounts, two colours, used everywhere that account appears: map dot,
 * "logged by" chips, note attribution, and calendar blocks.
 */
export const USER_COLORS = ["#2f80ff", "#ff4fd8"] as const;
export const FALLBACK_USER_COLOR = "#00d9ff";

/**
 * Assignment is by uid sort order rather than login order, so both phones show
 * the same person in the same colour without any extra coordination. A `color`
 * field on the user document overrides it if you ever want to swap them.
 */
export function buildUserColorMap(users: AppUser[]): Record<string, string> {
  const byUid = [...users].sort((a, b) => a.uid.localeCompare(b.uid));
  const map: Record<string, string> = {};
  byUid.forEach((user, index) => {
    map[user.uid] = user.color ?? USER_COLORS[index] ?? FALLBACK_USER_COLOR;
  });
  return map;
}

export function colorForUser(
  uid: string | null | undefined,
  colorMap: Record<string, string>,
): string {
  if (!uid) return FALLBACK_USER_COLOR;
  return colorMap[uid] ?? FALLBACK_USER_COLOR;
}

/** Black or white, whichever stays readable on the given background. */
export function readableInkOn(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#ffffff";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  // Rec. 709 relative luminance, good enough for a two-way choice.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#0b0f14" : "#ffffff";
}
