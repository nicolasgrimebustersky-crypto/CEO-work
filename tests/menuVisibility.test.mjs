/**
 * The menu switches: each person hides screens from their own menu. Account
 * can't be hidden, because that's where the switches are.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { isShown, toggleHidden, asHiddenMenu, canHide } = await import("../lib/menuVisibility.ts");

describe("menu switches", () => {
  test("everything shows until it is switched off; a new screen shows by default", () => {
    assert.equal(isShown("/mileage", []), true);
    assert.equal(isShown("/mileage", undefined), true);
    assert.equal(isShown("/mileage", ["/mileage"]), false);
    assert.equal(isShown("/brand-new", ["/mileage"]), true);
  });

  test("a switch flips one screen and back", () => {
    const off = toggleHidden([], "/mileage");
    assert.deepEqual(off, ["/mileage"]);
    assert.deepEqual(toggleHidden(off, "/mileage"), []);
    assert.deepEqual(toggleHidden(["/a", "/a"], "/b"), ["/a", "/b"]);
  });

  test("Account can never be switched off, even if the stored list says so", () => {
    assert.equal(canHide("/account"), false);
    assert.deepEqual(toggleHidden([], "/account"), []);
    assert.equal(isShown("/account", ["/account"]), true);
    assert.deepEqual(asHiddenMenu(["/account", "/mileage"]), ["/mileage"]);
  });

  test("junk in the stored list is dropped", () => {
    assert.deepEqual(asHiddenMenu("nope"), []);
    assert.deepEqual(asHiddenMenu([3, null, "mileage", "/x".padEnd(100, "x"), "/ok"]), ["/ok"]);
  });
});
