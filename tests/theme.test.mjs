/**
 * Guards the design tokens against shadowing Tailwind's own utilities.
 *
 * Tailwind v4 generates a utility for every `--color-*` you declare in
 * `@theme`. Name one `--color-base` and it emits `.text-base{color:…}`, which
 * silently replaces the built-in `text-base` font-size utility — and since the
 * whole app writes `text-base font-semibold text-accent`, whichever colour
 * utility Tailwind happens to emit last wins. That shipped: every accent-
 * coloured figure in the app (dashboard revenue, invoice totals, quote amounts)
 * rendered near-black on a near-black surface for weeks, because `.text-base`
 * sorted after `.text-accent`.
 *
 * Nothing in the build fails when this happens. So this test does.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, describe } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(repoRoot, "app/globals.css"), "utf8");

/** Token names that used to exist. Add to this whenever one is renamed. */
const RETIRED_TOKENS = ["base"];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(tsx?|css)$/.test(entry.name)) yield full;
  }
}

/** Tailwind's built-in scales, whose names a theme colour must not reuse. */
const FONT_SIZES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"];
const FONT_WEIGHTS = [
  "thin",
  "extralight",
  "light",
  "normal",
  "medium",
  "semibold",
  "bold",
  "extrabold",
  "black",
];
const ALIGNMENTS = ["left", "center", "right", "justify", "start", "end"];

function themeColorNames() {
  const block = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, "globals.css should declare an @theme block");
  return [...block[1].matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]);
}

describe("design tokens", () => {
  test("no colour token shadows a text-* utility", () => {
    const reserved = new Set([...FONT_SIZES, ...FONT_WEIGHTS, ...ALIGNMENTS]);
    const clashes = themeColorNames().filter((name) => reserved.has(name));

    assert.deepEqual(
      clashes,
      [],
      `--color-${clashes.join(", --color-")} makes text-${clashes.join(
        "/text-",
      )} a colour utility, shadowing Tailwind's own. Rename the token.`,
    );
  });

  test("the tokens the app relies on are all present", () => {
    // A rename that misses a usage site fails silently — Tailwind just drops
    // the unknown class. Pin the ones the whole UI is built from.
    const names = themeColorNames();
    for (const required of [
      "canvas",
      "surface",
      "surface-2",
      "surface-3",
      "line",
      "ink",
      "muted",
      "accent",
      "accent-ink",
      "money",
      "money-ink",
      "danger",
      "warn",
      "ok",
    ]) {
      assert.ok(names.includes(required), `--color-${required} is missing from @theme`);
    }
  });

  test("no retired token name is still referenced in the UI", () => {
    // The other half of a rename: markup still saying `bg-base` after the
    // token became `--color-canvas` renders as no background at all, and
    // Tailwind says nothing because an unknown class is simply dropped.
    const stale = [];
    // `text-` is deliberately absent: `text-base` is a legitimate font-size
    // utility now that the token is gone, and the shadowing test above is what
    // guards that name. These prefixes only ever mean a colour.
    const prefixes = "bg|border|ring|fill|stroke|divide|outline|from|to|via|caret|decoration";

    for (const dir of ["app", "components"]) {
      for (const file of walk(join(repoRoot, dir))) {
        const source = readFileSync(file, "utf8");
        for (const retired of RETIRED_TOKENS) {
          const pattern = new RegExp(`\\b(${prefixes})-${retired}\\b`);
          if (pattern.test(source)) stale.push(`${file.slice(repoRoot.length + 1)} → ${retired}`);
        }
      }
    }

    assert.deepEqual(stale, [], `Retired colour tokens still in use:\n${stale.join("\n")}`);
  });
});
