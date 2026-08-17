/**
 * Tests for the message somebody actually reads when a screen will not load.
 *
 * "Missing or insufficient permissions." is what Firestore says, and it is the
 * least useful true sentence available — it covers both "the rules were never
 * deployed" and "this account is not approved", which are fixed in completely
 * different places. Getting somebody to the right one is the whole job here.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { friendlyError } = await import("../lib/db/errors.ts");

/** What the Firestore SDK actually throws. */
const denied = Object.assign(new Error("Missing or insufficient permissions."), {
  code: "permission-denied",
});

describe("a refused read", () => {
  test("names the thing that would not load", () => {
    assert.match(friendlyError(denied, "routes"), /routes/);
    assert.match(friendlyError(denied, "chats"), /chats/);
  });

  test("points at the rules deploy, with the command", () => {
    // The common case by far: rules ship separately from the app, so a new
    // feature is denied by a database that has never heard of its collection.
    const out = friendlyError(denied, "routes");
    assert.match(out, /firebase deploy --only firestore:rules/);
  });

  test("also offers the other explanation", () => {
    assert.match(friendlyError(denied, "routes"), /approved/i);
  });

  test("gives the reader a way to tell them apart", () => {
    // One screen broken means a missing rule; everything broken means the
    // account. Without that, both explanations are equally unhelpful.
    const out = friendlyError(denied, "routes");
    assert.match(out, /rest of the app|nothing works/i);
  });
});

describe("recognising it at all", () => {
  test("by the SDK error code", () => {
    const coded = Object.assign(new Error("nope"), { code: "permission-denied" });
    assert.match(friendlyError(coded, "x"), /firebase deploy/);
  });

  test("by the message alone, when the code was lost", () => {
    // Re-thrown errors and older SDK paths keep the sentence and drop the
    // code. Falling through to a generic message here would defeat the point.
    assert.match(
      friendlyError(new Error("Missing or insufficient permissions."), "x"),
      /firebase deploy/,
    );
  });

  test("case-insensitively", () => {
    assert.match(
      friendlyError(new Error("MISSING OR INSUFFICIENT PERMISSIONS"), "x"),
      /firebase deploy/,
    );
  });
});

describe("everything else is passed through", () => {
  test("a real error keeps its own message", () => {
    // Rewriting an unrelated failure as a permissions problem would send
    // somebody to deploy rules that were never the issue.
    assert.equal(friendlyError(new Error("Network request failed"), "x"), "Network request failed");
  });

  test("something that is not an error still reads as a sentence", () => {
    assert.equal(friendlyError(null, "routes"), "Could not load routes.");
    assert.equal(friendlyError(undefined, "chats"), "Could not load chats.");
    assert.equal(friendlyError({}, "jobs"), "Could not load jobs.");
  });

  test("an error with an empty message does not render blank", () => {
    assert.equal(friendlyError(new Error(""), "routes"), "Could not load routes.");
  });
});
