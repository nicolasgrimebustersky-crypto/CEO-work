/**
 * Deciding whether to tell somebody their link is out of date.
 *
 * The bias here is deliberate and one-directional: say nothing unless certain.
 * A banner that appears because the wifi dropped teaches everybody to ignore
 * banners, and the next one they ignore is the real one.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { STALE_BODY, STALE_TITLE, isStaleBuild, shortBuild } = await import(
  "../lib/buildVersion.ts"
);

const OLD = "7b7353b1c4f0a9e2d3b8c7a6f5e4d3c2b1a09876";
const LIVE = "1a61dad9f8e7d6c5b4a3928170f6e5d4c3b2a190";

describe("when it speaks up", () => {
  test("two different commits is out of date", () => {
    assert.equal(isStaleBuild(OLD, LIVE), true);
  });

  test("the same commit is the live build, and says nothing", () => {
    assert.equal(isStaleBuild(LIVE, LIVE), false);
  });

  test("whitespace does not make two identical builds look different", () => {
    // A trailing newline out of an env var would otherwise put a permanent
    // "you are out of date" banner on production itself.
    assert.equal(isStaleBuild(` ${LIVE} `, `${LIVE}\n`), false);
  });
});

describe("when it stays quiet", () => {
  test("a local build has no commit and is never called stale", () => {
    assert.equal(isStaleBuild("", LIVE), false);
    assert.equal(isStaleBuild(null, LIVE), false);
    assert.equal(isStaleBuild(undefined, LIVE), false);
  });

  test("no answer from production is not evidence of anything", () => {
    // Offline, blocked by a corporate proxy, or an endpoint older than this
    // feature. None of those means the build is old.
    assert.equal(isStaleBuild(OLD, ""), false);
    assert.equal(isStaleBuild(OLD, null), false);
    assert.equal(isStaleBuild(OLD, undefined), false);
  });

  test("neither known is silence, not an alarm", () => {
    assert.equal(isStaleBuild("", ""), false);
    assert.equal(isStaleBuild(null, undefined), false);
  });

  test("whitespace-only counts as absent", () => {
    assert.equal(isStaleBuild("   ", LIVE), false);
    assert.equal(isStaleBuild(OLD, "  \n "), false);
  });
});

describe("what it shows", () => {
  test("a short recognisable prefix, not a wall of hex", () => {
    assert.equal(shortBuild(OLD), "7b7353b");
    assert.equal(shortBuild(OLD).length, 7);
  });

  test("nothing missing turns into the string 'undefined'", () => {
    assert.equal(shortBuild(null), "");
    assert.equal(shortBuild(undefined), "");
    assert.equal(shortBuild(""), "");
  });

  test("the wording tells them what to do, not just what is wrong", () => {
    // "You're on an old link" alone leaves somebody stuck. The next sentence
    // has to say where the right one comes from.
    assert.match(STALE_TITLE, /old link/i);
    assert.match(STALE_BODY, /ask nicolas/i);
    assert.match(STALE_BODY, /current link/i);
  });
});
