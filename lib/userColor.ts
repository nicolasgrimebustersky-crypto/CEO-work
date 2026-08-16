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

export const INK_ON_LIGHT = "#050607";
export const INK_ON_DARK = "#ffffff";

/**
 * WCAG relative luminance.
 *
 * The channels have to be linearised before they are weighted. Weighting the
 * raw 0–255 values — which is the obvious-looking version, and what this file
 * did until it was measured — overstates the luminance of saturated colours
 * badly: the pink crew colour came out at 0.50 and so got white text at
 * 2.85:1, when black on the same pink is 7.4:1. Nobody notices because the
 * chip is small and the name is short, and it is unreadable in sunlight all
 * the same.
 */
function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: number, b: number): number {
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Black or white, whichever is genuinely more readable on the given colour.
 *
 * Decided by comparing the two contrast ratios rather than by a luminance
 * threshold, so it is right by construction for any colour someone sets on
 * their profile, not just for the two shipped ones.
 */
export function readableInkOn(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return INK_ON_DARK;

  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return INK_ON_DARK;

  const background = relativeLuminance(r, g, b);
  const onLight = contrast(background, relativeLuminance(5, 6, 7));
  const onDark = contrast(background, relativeLuminance(255, 255, 255));

  return onLight >= onDark ? INK_ON_LIGHT : INK_ON_DARK;
}
