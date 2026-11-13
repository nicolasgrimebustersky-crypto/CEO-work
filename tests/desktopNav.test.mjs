/**
 * The computer-screen sidebar: every screen reachable, in its group.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, describe } from "node:test";

const { desktopGroups, DESKTOP_GROUPS, DESKTOP_ELSEWHERE } = await import("../lib/desktopNav.ts");
const { routes } = await import("../lib/routes.ts");

const item = (href) => ({ href, label: href });

describe("desktop sidebar groups", () => {
  test("every screen in the app's menu has a deliberate place on a computer", () => {
    const source = readFileSync(new URL("../components/shell/navItems.ts", import.meta.url), "utf8");
    const hrefs = [...source.matchAll(/href: routes\.(\w+),/g)].map((m) => routes[m[1]]);
    assert.ok(hrefs.length >= 15, "found the menu's screens");
    const placed = new Set([...DESKTOP_GROUPS.flatMap((g) => g.hrefs), ...DESKTOP_ELSEWHERE]);
    assert.deepEqual(hrefs.filter((h) => !placed.has(h)), []);
  });

  test("groups keep their order and drop screens that were switched off", () => {
    const groups = desktopGroups([item("/map"), item("/dashboard"), item("/invoices")]);
    assert.deepEqual(
      groups.map((g) => [g.label, g.items.map((i) => i.href)]),
      [["Today", ["/dashboard", "/map"]], ["Money", ["/invoices"]]],
    );
  });

  test("search and account live elsewhere; an unknown new screen still shows under More", () => {
    const groups = desktopGroups([item("/search"), item("/account"), item("/brand-new"), item("/chat")]);
    assert.deepEqual(
      groups.map((g) => [g.label, g.items.map((i) => i.href)]),
      [["Workspace", ["/chat"]], ["More", ["/brand-new"]]],
    );
  });

  test("no screen is listed twice", () => {
    const all = DESKTOP_GROUPS.flatMap((g) => g.hrefs);
    assert.equal(new Set(all).size, all.length);
  });
});
