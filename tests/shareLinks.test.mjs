/**
 * The customer's link to their own estimate.
 *
 * The token is the entire authorisation on the page it opens, so these tests
 * care about two things: that the shape check refuses anything that is not one
 * of ours before a lookup happens, and that a link is either absolute and
 * correct or is not produced at all.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { SHARE_TOKEN_BYTES, SHARE_PATH, normalizeShareToken, looksLikeShareToken, shareUrl } =
  await import("../lib/shareLinks.ts");

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345"; // 32 chars, base64url alphabet

describe("the shape of a share token", () => {
  test("24 bytes is 32 base64url characters", () => {
    assert.equal(SHARE_TOKEN_BYTES, 24);
    assert.equal(Math.ceil((SHARE_TOKEN_BYTES * 4) / 3), 32);
  });

  test("a real token passes", () => {
    assert.equal(looksLikeShareToken(TOKEN), true);
  });

  test("surrounding whitespace does not change the answer", () => {
    // The shape check and the lookup must agree about what the token is, or a
    // pasted token with a trailing newline is refused as malformed.
    assert.equal(looksLikeShareToken(`  ${TOKEN}\n`), true);
    assert.equal(normalizeShareToken(`  ${TOKEN}\n`), TOKEN);
  });

  test("nothing, or nearly nothing, fails", () => {
    for (const bad of [null, undefined, "", "   ", "short", "a".repeat(31)]) {
      assert.equal(looksLikeShareToken(bad), false, `accepted ${JSON.stringify(bad)}`);
    }
  });

  test("path traversal and file names are refused before any lookup", () => {
    // These are what actually arrives at /v/<something>: crawlers, and the odd
    // probe. None of them should cost a database read.
    for (const bad of ["../admin", "..", "favicon.ico", "robots.txt", `${TOKEN}/../x`]) {
      assert.equal(looksLikeShareToken(bad), false, `accepted ${bad}`);
    }
  });

  test("a token longer than the cap is refused", () => {
    assert.equal(looksLikeShareToken("a".repeat(65)), false);
  });
});

describe("building the link", () => {
  test("origin and token become an absolute URL", () => {
    assert.equal(shareUrl("https://ceo-work.vercel.app", TOKEN), `https://ceo-work.vercel.app/v/${TOKEN}`);
  });

  test("a trailing slash on the origin does not double up", () => {
    assert.equal(shareUrl("https://x.app/", TOKEN), `https://x.app/v/${TOKEN}`);
  });

  test("no origin means no link, never a relative one", () => {
    // A relative path is useless in a text message, so the caller has to be
    // told it cannot make one rather than handed something that looks fine.
    assert.equal(shareUrl("", TOKEN), null);
    assert.equal(shareUrl(null, TOKEN), null);
    assert.equal(shareUrl(undefined, TOKEN), null);
  });

  test("an origin that is not a URL is refused", () => {
    assert.equal(shareUrl("ceo-work.vercel.app", TOKEN), null);
    assert.equal(shareUrl("javascript:alert(1)", TOKEN), null);
  });

  test("a bad token never reaches the URL", () => {
    assert.equal(shareUrl("https://x.app", "../secrets"), null);
    assert.equal(shareUrl("https://x.app", ""), null);
  });

  test("the path matches what the route serves", () => {
    assert.equal(SHARE_PATH, "/v");
    assert.ok(shareUrl("https://x.app", TOKEN)?.includes(`${SHARE_PATH}/`));
  });
});
