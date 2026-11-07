/**
 * Which screens show in each person's menu.
 *
 * Stored on the person's own profile as the screens they switched OFF, the
 * same way muted notifications are: a screen added later shows up for
 * everyone by default instead of staying hidden from people who were never
 * asked about it.
 *
 * Hiding a screen only takes it out of the menu (and the bottom bar). It does
 * not turn the feature off: trips still log from "En route", the address is
 * still reachable, and nothing about who may see what changes — that is the
 * security rules' job, not the menu's.
 *
 * Free of imports, so the rule is a test.
 */

/** Account holds the switches, so it can never be switched off. */
export const ALWAYS_SHOWN: readonly string[] = ["/account"];

export const MAX_HIDDEN = 40;

export function canHide(href: string): boolean {
  return !ALWAYS_SHOWN.includes(href);
}

export function isShown(href: string, hidden: readonly string[] | null | undefined): boolean {
  return !canHide(href) || !(hidden ?? []).includes(href);
}

/** The new list after flipping one screen's switch. */
export function toggleHidden(hidden: readonly string[] | null | undefined, href: string): string[] {
  const current = (hidden ?? []).filter((h) => typeof h === "string" && canHide(h));
  if (!canHide(href)) return current;
  const next = current.includes(href) ? current.filter((h) => h !== href) : [...current, href];
  return [...new Set(next)].slice(0, MAX_HIDDEN);
}

/** Stored values, cleaned: strings that look like app paths, never Account. */
export function asHiddenMenu(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((h): h is string => typeof h === "string" && h.startsWith("/") && h.length <= 80 && canHide(h)))].slice(
    0,
    MAX_HIDDEN,
  );
}
