/**
 * The sign-in code.
 *
 * `sessionIsVerified` is the rule the Firestore rules and every API route
 * enforce, so most of this file is about it refusing things: a missing claim,
 * a claim for a different sign-in, a claim of the wrong type. The input
 * helpers are here because six boxes that disagree about a paste is a screen
 * nobody can get through.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  OTP_LENGTH,
  VERIFIED_SESSIONS_KEPT,
  digitsOnly,
  isCompleteCode,
  maskEmail,
  sessionIsVerified,
  withVerifiedSession,
  placeDigits,
  eraseDigit,
  emptyBoxes,
} = await import("../lib/otp.ts");

const T = 1_700_000_000;

describe("whether this sign-in has passed", () => {
  test("yes when its auth_time is in the list", () => {
    assert.equal(sessionIsVerified({ auth_time: T, otpAuths: [T - 50, T] }), true);
  });

  test("no with no claim at all — a fresh password sign-in", () => {
    assert.equal(sessionIsVerified({ auth_time: T }), false);
  });

  test("no when the list is for other sign-ins — another device passed, not this one", () => {
    // The hole a single "verified" flag would have. A thief signing in while
    // the owner's phone is verified must still be stopped.
    assert.equal(sessionIsVerified({ auth_time: T + 1, otpAuths: [T] }), false);
  });

  test("no when the types are wrong, whatever the values say", () => {
    assert.equal(sessionIsVerified({ auth_time: String(T), otpAuths: [T] }), false);
    assert.equal(sessionIsVerified({ auth_time: T, otpAuths: String(T) }), false);
    assert.equal(sessionIsVerified({ auth_time: T, otpAuths: { 0: T } }), false);
    assert.equal(sessionIsVerified({ auth_time: T + 0.5, otpAuths: [T + 0.5] }), false);
    assert.equal(sessionIsVerified({}), false);
  });
});

describe("recording a pass", () => {
  test("adds this sign-in and keeps the others", () => {
    assert.deepEqual(withVerifiedSession([T - 100], T), [T - 100, T]);
  });

  test("starts a list when there was nothing, or nonsense", () => {
    assert.deepEqual(withVerifiedSession(undefined, T), [T]);
    assert.deepEqual(withVerifiedSession("junk", T), [T]);
    assert.deepEqual(withVerifiedSession([T, "junk", 1.5, null], T), [T]);
  });

  test("does not duplicate a sign-in verified twice", () => {
    assert.deepEqual(withVerifiedSession([T], T), [T]);
  });

  test("forgets the oldest once the list is full", () => {
    const many = Array.from({ length: VERIFIED_SESSIONS_KEPT }, (_, i) => T + i);
    const after = withVerifiedSession(many, T + 1000);
    assert.equal(after.length, VERIFIED_SESSIONS_KEPT);
    assert.ok(!after.includes(T), "the oldest sign-in should have been dropped");
    assert.ok(after.includes(T + 1000));
  });

  test("the cut is by sign-in time, not insertion order", () => {
    const after = withVerifiedSession([T + 5, T + 1, T + 3], T + 2);
    assert.deepEqual(after, [T + 1, T + 2, T + 3, T + 5]);
  });
});

describe("what counts as a code", () => {
  test("digits only, six at most", () => {
    assert.equal(digitsOnly("20 48 15"), "204815");
    assert.equal(digitsOnly("2048159"), "204815");
    assert.equal(digitsOnly("abc"), "");
    assert.equal(digitsOnly(null), "");
  });

  test("complete means exactly six digits", () => {
    assert.equal(isCompleteCode("204815"), true);
    assert.equal(isCompleteCode("20481"), false);
    assert.equal(isCompleteCode("2048150"), false);
    assert.equal(isCompleteCode("20481a"), false);
  });
});

describe("the address on the screen", () => {
  test("keeps enough to recognise, hides the rest", () => {
    // Two characters kept, one dot per hidden character, the domain intact.
    assert.equal(
      maskEmail("nicolas.grimebustersky@gmail.com"),
      `ni${"•".repeat("nicolas.grimebustersky".length - 2)}@gmail.com`,
    );
    assert.equal(maskEmail("al@x.io"), "al•••@x.io");
  });

  test("leaves a thing that is not an address alone", () => {
    assert.equal(maskEmail("not-an-email"), "not-an-email");
  });
});

describe("the six boxes", () => {
  test("a keystroke fills one box and moves on", () => {
    const { boxes, focus } = placeDigits(emptyBoxes(), 0, "2");
    assert.deepEqual(boxes, ["2", "", "", "", "", ""]);
    assert.equal(focus, 1);
  });

  test("a paste of the whole code fills every box at once", () => {
    const { boxes, focus } = placeDigits(emptyBoxes(), 0, "204815");
    assert.deepEqual(boxes, ["2", "0", "4", "8", "1", "5"]);
    assert.equal(focus, OTP_LENGTH - 1);
  });

  test("iOS autofilling all six into the first box is the same as a paste", () => {
    const { boxes } = placeDigits(emptyBoxes(), 0, "204815");
    assert.equal(boxes.join(""), "204815");
  });

  test("a paste into the middle fills from there and stops at the end", () => {
    const { boxes, focus } = placeDigits(["2", "0", "4", "", "", ""], 3, "815999");
    assert.deepEqual(boxes, ["2", "0", "4", "8", "1", "5"]);
    assert.equal(focus, OTP_LENGTH - 1);
  });

  test("a paste with spaces or dashes in it still lands", () => {
    const { boxes } = placeDigits(emptyBoxes(), 0, "204-815");
    assert.equal(boxes.join(""), "204815");
  });

  test("a non-digit clears the box rather than landing in it", () => {
    const { boxes, focus } = placeDigits(["2", "0", "", "", "", ""], 1, "x");
    assert.deepEqual(boxes, ["2", "", "", "", "", ""]);
    assert.equal(focus, 1);
  });

  test("backspace clears the current box, then walks back", () => {
    let state = eraseDigit(["2", "0", "4", "", "", ""], 2);
    assert.deepEqual(state.boxes, ["2", "0", "", "", "", ""]);
    assert.equal(state.focus, 2);
    state = eraseDigit(state.boxes, 2);
    assert.deepEqual(state.boxes, ["2", "", "", "", "", ""]);
    assert.equal(state.focus, 1);
  });

  test("backspace in the first empty box stays put", () => {
    const { boxes, focus } = eraseDigit(emptyBoxes(), 0);
    assert.deepEqual(boxes, emptyBoxes());
    assert.equal(focus, 0);
  });
});
