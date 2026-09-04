/**
 * Which paths render without a session.
 *
 * This list is the difference between a customer reading their quote and a
 * customer hitting a login screen, and between a public page and one that
 * leaks the app's navigation to a stranger. Both components that consult it —
 * AuthGate and AppShell — trust it completely, so it is worth pinning.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { isPublicRoute } = await import("../lib/publicRoutes.ts");

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

describe("public routes", () => {
  test("the privacy policy, with or without a trailing slash", () => {
    assert.equal(isPublicRoute("/privacy"), true);
    assert.equal(isPublicRoute("/privacy/"), true);
  });

  test("a share link is public", () => {
    assert.equal(isPublicRoute(`/v/${TOKEN}`), true);
    assert.equal(isPublicRoute(`/v/${TOKEN}/`), true);
  });

  test("the bare prefix is not", () => {
    // There is no document without a token, so /v and /v/ have nothing to show
    // and must not be treated as a page that renders without a session.
    assert.equal(isPublicRoute("/v"), false);
    assert.equal(isPublicRoute("/v/"), false);
  });

  test("the app itself is not public", () => {
    for (const path of ["/", "/customers", "/invoices", "/account", "/map", "/reports"]) {
      assert.equal(isPublicRoute(path), false, `${path} was treated as public`);
    }
  });

  test("a path that merely starts with the letter v is not public", () => {
    // Prefix matching is the risk here: "/vault" must not slip through on the
    // strength of sharing two characters with "/v/".
    for (const path of ["/vault", "/versions", "/v-something", "/privacy-policy"]) {
      assert.equal(isPublicRoute(path), false, `${path} was treated as public`);
    }
  });
});
