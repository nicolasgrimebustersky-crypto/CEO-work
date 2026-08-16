/**
 * Tests for the message threads.
 *
 * Threads are derived from the notes timeline rather than stored, so the thing
 * worth pinning is the derivation — particularly "needs reply", which is the
 * whole reason the screen exists. Getting that backwards would show an empty
 * inbox while a customer sits waiting, and nothing would look broken.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { buildThreads, needsReplyCount, previewOf } = await import("../lib/threads.ts");

/** Firestore's Timestamp, reduced to the one method this code uses. */
const at = (minutesAgo) => ({ toMillis: () => 1_700_000_000_000 - minutesAgo * 60_000 });

const note = (id, kind, text, minutesAgo, authorName = "Nick") => ({
  id,
  kind,
  text,
  authorName,
  createdAt: at(minutesAgo),
});

const customer = (id, notes) => ({ id, notes });

describe("building threads", () => {
  test("only texts make it in", () => {
    const threads = buildThreads([
      customer("c1", [
        note("n1", "note", "Gate code 4417", 10),
        note("n2", "sms_out", "On our way", 5),
        note("n3", "status_change", "Now a customer", 3),
      ]),
    ]);
    assert.equal(threads.length, 1);
    assert.deepEqual(
      threads[0].messages.map((m) => m.text),
      ["On our way"],
    );
  });

  test("a customer who has never texted has no thread", () => {
    const threads = buildThreads([customer("c1", [note("n1", "note", "Knocked", 1)])]);
    assert.deepEqual(threads, []);
  });

  test("messages read oldest first, whatever order they were stored in", () => {
    const threads = buildThreads([
      customer("c1", [
        note("n2", "sms_in", "second", 5),
        note("n1", "sms_out", "first", 10),
        note("n3", "sms_in", "third", 1),
      ]),
    ]);
    assert.deepEqual(
      threads[0].messages.map((m) => m.text),
      ["first", "second", "third"],
    );
    assert.equal(threads[0].last.text, "third");
  });

  test("direction follows the note kind", () => {
    const threads = buildThreads([
      customer("c1", [note("n1", "sms_out", "hi", 2), note("n2", "sms_in", "hey", 1)]),
    ]);
    assert.deepEqual(
      threads[0].messages.map((m) => m.direction),
      ["out", "in"],
    );
  });

  test("the most recently active conversation is first", () => {
    const threads = buildThreads([
      customer("old", [note("a", "sms_in", "ages ago", 500)]),
      customer("fresh", [note("b", "sms_in", "just now", 1)]),
      customer("middle", [note("c", "sms_out", "yesterday", 60)]),
    ]);
    assert.deepEqual(
      threads.map((t) => t.customerId),
      ["fresh", "middle", "old"],
    );
  });
});

describe("who is waiting on an answer", () => {
  test("their message last means they are waiting", () => {
    const threads = buildThreads([
      customer("c1", [note("a", "sms_out", "quote attached", 10), note("b", "sms_in", "sounds good", 2)]),
    ]);
    assert.equal(threads[0].needsReply, true);
  });

  test("our message last means they are not", () => {
    const threads = buildThreads([
      customer("c1", [note("a", "sms_in", "when can you come", 10), note("b", "sms_out", "Thursday", 2)]),
    ]);
    assert.equal(threads[0].needsReply, false);
  });

  test("answering clears it without anything being written", () => {
    // Derived, never stored — so it cannot be left stale by a failed write or
    // disagree between the two phones.
    const notes = [note("a", "sms_in", "you there?", 10)];
    assert.equal(buildThreads([customer("c1", notes)])[0].needsReply, true);
    notes.push(note("b", "sms_out", "yes, tomorrow", 1));
    assert.equal(buildThreads([customer("c1", notes)])[0].needsReply, false);
  });

  test("the badge counts conversations, not messages", () => {
    const threads = buildThreads([
      customer("c1", [note("a", "sms_in", "one", 5), note("b", "sms_in", "two", 4)]),
      customer("c2", [note("c", "sms_in", "three", 3)]),
      customer("c3", [note("d", "sms_out", "answered", 2)]),
    ]);
    assert.equal(needsReplyCount(threads), 2);
  });
});

describe("the inbox preview", () => {
  test("says who spoke last", () => {
    const [ours] = buildThreads([customer("c1", [note("a", "sms_out", "On our way", 1)])]);
    const [theirs] = buildThreads([customer("c2", [note("b", "sms_in", "Great thanks", 1)])]);
    assert.equal(previewOf(ours), "You: On our way");
    assert.equal(previewOf(theirs), "Great thanks");
  });

  test("collapses newlines so a row stays one line", () => {
    const [thread] = buildThreads([
      customer("c1", [note("a", "sms_in", "line one\n\nline two", 1)]),
    ]);
    assert.equal(previewOf(thread), "line one line two");
  });

  test("long messages are clipped, not wrapped", () => {
    const [thread] = buildThreads([customer("c1", [note("a", "sms_in", "x".repeat(200), 1)])]);
    const preview = previewOf(thread, 20);
    assert.equal(preview.length, 20);
    assert.ok(preview.endsWith("…"));
  });
});
