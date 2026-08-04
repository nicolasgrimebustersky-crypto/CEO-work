/**
 * Tests for the crew colour helpers.
 *
 * `readableInkOn` decides the text colour on every attribution chip in the
 * app. It shipped weighting raw sRGB channels instead of linearised ones,
 * which put white text on the pink crew colour at 2.85:1 — legible on a
 * desk, not on a phone in a driveway in July. These pin the real ratios so
 * the "obvious" version cannot come back.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { readableInkOn, USER_COLORS, FALLBACK_USER_COLOR, buildUserColorMap } =
  await import("../lib/userColor.ts");

/** WCAG contrast between two hex colours. */
function contrast(a, b) {
  const lum = (hex) => {
    const clean = hex.replace("#", "");
    const channel = (i) => {
      const c = parseInt(clean.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  };
  const [light, dark] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("readableInkOn", () => {
  test("every crew colour gets ink it can actually be read against", () => {
    for (const color of [...USER_COLORS, FALLBACK_USER_COLOR]) {
      const ink = readableInkOn(color);
      const ratio = contrast(color, ink);
      assert.ok(
        ratio >= 4.5,
        `${color} with ${ink} is only ${ratio.toFixed(2)}:1 — needs 4.5:1`,
      );
    }
  });

  test("it picks whichever of black and white is actually better", () => {
    for (const color of [...USER_COLORS, FALLBACK_USER_COLOR, "#7c3aed", "#facc15", "#0d0d0d"]) {
      const chosen = readableInkOn(color);
      const other = chosen === "#ffffff" ? "#050607" : "#ffffff";
      assert.ok(
        contrast(color, chosen) >= contrast(color, other),
        `${color}: picked ${chosen} (${contrast(color, chosen).toFixed(2)}:1) over ${other} (${contrast(color, other).toFixed(2)}:1)`,
      );
    }
  });

  test("the pink crew colour takes black, not white", () => {
    // The specific regression: 2.85:1 white vs 7.4:1 black.
    assert.equal(readableInkOn("#ff4fd8"), "#050607");
  });

  test("a malformed colour still returns something renderable", () => {
    assert.equal(readableInkOn("nonsense"), "#ffffff");
    assert.equal(readableInkOn("#fff"), "#ffffff");
  });
});

describe("buildUserColorMap", () => {
  test("assignment follows uid order, so both phones agree", () => {
    const users = [{ uid: "zeta" }, { uid: "alpha" }];
    const map = buildUserColorMap(users);
    assert.equal(map.alpha, USER_COLORS[0]);
    assert.equal(map.zeta, USER_COLORS[1]);

    // Same set, opposite input order, same result.
    const reversed = buildUserColorMap([{ uid: "alpha" }, { uid: "zeta" }]);
    assert.deepEqual(reversed, map);
  });

  test("an explicit colour on the profile wins", () => {
    const map = buildUserColorMap([{ uid: "a", color: "#123456" }, { uid: "b" }]);
    assert.equal(map.a, "#123456");
  });
});
