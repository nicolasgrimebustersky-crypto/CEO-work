/**
 * How the computer-screen sidebar groups the app's screens.
 *
 * The phone splits navigation in two — five thumb tabs and a drawer — because
 * a thumb has five comfortable positions. A computer has room for the whole
 * list at once, so the sidebar shows every screen, in groups that read the
 * way the business runs: the day's work, the money, the people, the tools.
 *
 * The groups name screens by their path rather than holding them, so this
 * file has no imports and the rule is a test. A screen nobody put in a group
 * still shows, under "More": adding a screen to the app can never silently
 * leave it unreachable on a computer.
 */

export interface DesktopGroup<T> {
  label: string;
  items: T[];
}

/** The order the groups appear in, and the screens in each. */
export const DESKTOP_GROUPS: readonly { label: string; hrefs: readonly string[] }[] = [
  { label: "Today", hrefs: ["/dashboard", "/schedule", "/map", "/routes"] },
  { label: "Money", hrefs: ["/invoices", "/reports", "/expenses", "/mileage", "/pay"] },
  { label: "Clients", hrefs: ["/customers", "/pipeline", "/tasks", "/messages", "/campaigns"] },
  { label: "Workspace", hrefs: ["/chat", "/automations", "/services", "/equipment"] },
];

/**
 * Screens that live somewhere else on a computer: search is the box across
 * the top, and account is the person's own card at the foot of the sidebar.
 */
export const DESKTOP_ELSEWHERE: readonly string[] = ["/search", "/account"];

/**
 * `items` in sidebar groups, keeping each group's order. Empty groups are
 * dropped (every screen in one was switched off), and anything not named
 * above lands in a trailing "More" group.
 */
export function desktopGroups<T extends { href: string }>(items: readonly T[]): DesktopGroup<T>[] {
  const byHref = new Map(items.map((item) => [item.href, item]));
  const placed = new Set<string>(DESKTOP_ELSEWHERE);
  const groups: DesktopGroup<T>[] = [];

  for (const group of DESKTOP_GROUPS) {
    const found = group.hrefs.flatMap((href) => {
      const item = byHref.get(href);
      if (!item || placed.has(href)) return [];
      placed.add(href);
      return [item];
    });
    if (found.length > 0) groups.push({ label: group.label, items: found });
  }

  const rest = items.filter((item) => !placed.has(item.href));
  if (rest.length > 0) groups.push({ label: "More", items: rest });
  return groups;
}
