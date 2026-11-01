import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NOT_PAUSED,
  PAUSE_CHOICES,
  isPaused,
  pauseFor,
  readPause,
} from "../lib/automationPause.ts";

const NOW = Date.UTC(2026, 9, 16, 13, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test("the four choices are exactly 1 hour, 1 day, 3 days and Forever, in that order", () => {
  assert.deepEqual(
    PAUSE_CHOICES.map((choice) => [choice.key, choice.label, choice.ms]),
    [
      ["1h", "1 hour", HOUR],
      ["1d", "1 day", DAY],
      ["3d", "3 days", 3 * DAY],
      ["forever", "Forever", null],
    ],
  );
});

test("each timed choice ends exactly its length after now", () => {
  assert.deepEqual(pauseFor("1h", NOW), { pausedUntilMs: NOW + HOUR, pausedForever: false });
  assert.deepEqual(pauseFor("1d", NOW), { pausedUntilMs: NOW + DAY, pausedForever: false });
  assert.deepEqual(pauseFor("3d", NOW), { pausedUntilMs: NOW + 3 * DAY, pausedForever: false });
});

test("Forever has no end time and is flagged", () => {
  assert.deepEqual(pauseFor("forever", NOW), { pausedUntilMs: null, pausedForever: true });
});

test("an unknown choice pauses nothing", () => {
  assert.deepEqual(pauseFor("1w", NOW), NOT_PAUSED);
  assert.deepEqual(pauseFor("", NOW), NOT_PAUSED);
});

test("a timed pause holds until its end and lifts exactly at it", () => {
  const state = pauseFor("1d", NOW);
  assert.equal(isPaused(state, NOW), true);
  assert.equal(isPaused(state, NOW + DAY - 1), true);
  // "1 day" from today's 9:00 run must not swallow tomorrow's 9:00 run.
  assert.equal(isPaused(state, NOW + DAY), false);
  assert.equal(isPaused(state, NOW + DAY + 1), false);
});

test("Forever holds at any time, however far ahead", () => {
  const state = pauseFor("forever", NOW);
  assert.equal(isPaused(state, NOW), true);
  assert.equal(isPaused(state, NOW + 10_000 * DAY), true);
});

test("no pause, and a missing state, are not paused", () => {
  assert.equal(isPaused(NOT_PAUSED, NOW), false);
  assert.equal(isPaused(null, NOW), false);
  assert.equal(isPaused(undefined, NOW), false);
});

test("a pause that ended in the past is not paused", () => {
  assert.equal(isPaused({ pausedUntilMs: NOW - 1, pausedForever: false }, NOW), false);
});

test("readPause: a row from before pausing existed reads as not paused", () => {
  assert.deepEqual(readPause({}), NOT_PAUSED);
});

test("readPause: reads a Timestamp-like and a real boolean", () => {
  const ts = { toMillis: () => NOW + HOUR };
  assert.deepEqual(readPause({ pausedUntil: ts, pausedForever: false }), {
    pausedUntilMs: NOW + HOUR,
    pausedForever: false,
  });
  assert.deepEqual(readPause({ pausedUntil: null, pausedForever: true }), {
    pausedUntilMs: null,
    pausedForever: true,
  });
});

test("readPause: unreadable values pause nothing rather than forever", () => {
  // A string "true" is not a pause. Treating it as one would stop a sequence
  // indefinitely on the strength of a malformed write.
  assert.deepEqual(readPause({ pausedForever: "true" }), NOT_PAUSED);
  assert.deepEqual(readPause({ pausedUntil: "2026-10-17" }), NOT_PAUSED);
  assert.deepEqual(readPause({ pausedUntil: 12345 }), NOT_PAUSED);
  assert.deepEqual(readPause({ pausedUntil: { toMillis: () => Number.NaN } }), NOT_PAUSED);
});
