/**
 * Tests for team chat.
 *
 * Most of this is naming and ordering, which sounds cosmetic and is not: a
 * direct chat is named from the point of view of whoever is looking, so the
 * same document has to read differently on two phones. Get that wrong and
 * everybody sees their own name in the list.
 *
 * The unread comparison is the other one worth pinning. Every wrong version of
 * it produces a badge that will not clear.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  MAX_MEMBERS,
  MAX_MESSAGE_LENGTH,
  byMostRecent,
  conversationProblem,
  hasUnread,
  isDirect,
  membersFor,
  messageProblem,
  previewOf,
  titleFor,
} = await import("../lib/chat/conversation.ts");

const NAMES = { nick: "Nick", noah: "Noah", dana: "Dana", sam: "Sam", kim: "Kim" };
const nameOf = (uid) => NAMES[uid] ?? "Unknown";

describe("who is in it", () => {
  test("the creator is always a member", () => {
    // A conversation you started and are not in would be invisible to you the
    // moment it existed — the rules only let members read it.
    assert.deepEqual(membersFor("nick", ["noah"]).sort(), ["nick", "noah"]);
    assert.ok(membersFor("nick", []).includes("nick"));
  });

  test("duplicates collapse", () => {
    // Picking yourself from the list, or the same person twice, must not
    // produce a three-person "group" with two of you in it.
    assert.deepEqual(membersFor("nick", ["noah", "noah", "nick"]).sort(), [
      "nick",
      "noah",
    ]);
  });

  test("junk entries are dropped", () => {
    assert.deepEqual(membersFor("nick", ["", null, undefined, "noah"]).sort(), [
      "nick",
      "noah",
    ]);
  });

  test("two people is a direct chat, three is a group", () => {
    assert.equal(isDirect(["nick", "noah"]), true);
    assert.equal(isDirect(["nick", "noah", "dana"]), false);
    assert.equal(isDirect(["nick"]), false);
  });
});

describe("what it is called", () => {
  test("a direct chat is named after the other person", () => {
    // The same document, two viewers, two different names. This is the whole
    // reason the title is derived rather than stored.
    const members = ["nick", "noah"];
    assert.equal(titleFor(members, null, "nick", nameOf), "Noah");
    assert.equal(titleFor(members, null, "noah", nameOf), "Nick");
  });

  test("a direct chat ignores a stored title", () => {
    assert.equal(titleFor(["nick", "noah"], "Ignore me", "nick", nameOf), "Noah");
  });

  test("a group uses its title", () => {
    assert.equal(
      titleFor(["nick", "noah", "dana"], "Saturday crew", "nick", nameOf),
      "Saturday crew",
    );
  });

  test("an unnamed group falls back to who is in it", () => {
    // A group nobody named is still something you have to be able to find.
    assert.equal(titleFor(["nick", "noah", "dana"], "", "nick", nameOf), "Noah, Dana");
    assert.equal(titleFor(["nick", "noah", "dana"], "   ", "nick", nameOf), "Noah, Dana");
  });

  test("a big unnamed group does not run off the row", () => {
    const big = ["nick", "noah", "dana", "sam", "kim"];
    assert.equal(titleFor(big, null, "nick", nameOf), "Noah, Dana, Sam +1");
  });

  test("a note to self is not blank", () => {
    assert.equal(titleFor(["nick"], null, "nick", nameOf), "You");
    assert.equal(titleFor(["nick", "nick"], null, "nick", nameOf), "You");
  });
});

describe("is there anything new in it", () => {
  test("a newer message is unread", () => {
    assert.equal(hasUnread(200, 100, "noah", "nick"), true);
  });

  test("an older message is not", () => {
    assert.equal(hasUnread(100, 200, "noah", "nick"), false);
  });

  test("reading the newest message clears it", () => {
    // Equal timestamps mean the last message IS the one you read. Treating
    // that as unread leaves a badge that never clears however many times you
    // open the thread.
    assert.equal(hasUnread(100, 100, "noah", "nick"), false);
  });

  test("your own message is never unread to you", () => {
    // The read receipt is written when the thread opens, but a message you
    // send arrives back through the same subscription a moment later. Without
    // this the thread you are looking at marks itself unread.
    assert.equal(hasUnread(999, 100, "nick", "nick"), false);
  });

  test("a conversation with no messages is not unread", () => {
    assert.equal(hasUnread(null, null, null, "nick"), false);
    assert.equal(hasUnread(undefined, 100, "noah", "nick"), false);
  });

  test("never having opened it still counts as unread", () => {
    assert.equal(hasUnread(100, null, "noah", "nick"), true);
    assert.equal(hasUnread(100, undefined, "noah", "nick"), true);
  });
});

describe("what stops you sending", () => {
  test("empty is refused", () => {
    assert.match(messageProblem(""), /Type something/);
    assert.match(messageProblem("   \n  "), /Type something/);
  });

  test("too long is refused, with the number", () => {
    assert.match(messageProblem("x".repeat(MAX_MESSAGE_LENGTH + 1)), /longer than/);
  });

  test("exactly the limit is fine", () => {
    assert.equal(messageProblem("x".repeat(MAX_MESSAGE_LENGTH)), null);
  });

  test("a normal message is fine", () => {
    assert.equal(messageProblem("on my way"), null);
  });
});

describe("what stops you starting one", () => {
  test("you cannot talk to nobody", () => {
    assert.match(conversationProblem(["nick"]), /at least one person/);
  });

  test("two is enough", () => {
    assert.equal(conversationProblem(["nick", "noah"]), null);
  });

  test("a runaway list is refused", () => {
    const many = Array.from({ length: MAX_MEMBERS + 1 }, (_, i) => `u${i}`);
    assert.match(conversationProblem(many), /more than/);
  });
});

describe("the line under each conversation", () => {
  test("newlines are flattened", () => {
    // A message with newlines would otherwise push every row below it down.
    assert.equal(previewOf("on my\nway\n\nnow"), "on my way now");
  });

  test("long messages are cut with an ellipsis", () => {
    const out = previewOf("x".repeat(200), 20);
    assert.equal(out.length, 20);
    assert.ok(out.endsWith("…"));
  });

  test("a short message is untouched", () => {
    assert.equal(previewOf("ok"), "ok");
  });
});

describe("the order they appear in", () => {
  test("most recent message first", () => {
    const out = byMostRecent([
      { id: "old", lastMessageAtMs: 100 },
      { id: "new", lastMessageAtMs: 300 },
      { id: "mid", lastMessageAtMs: 200 },
    ]);
    assert.deepEqual(out.map((c) => c.id), ["new", "mid", "old"]);
  });

  test("a brand new empty conversation sorts on when it was made", () => {
    // Otherwise the one you just started sinks below everything before you
    // have had a chance to type in it.
    const out = byMostRecent([
      { id: "chatty", lastMessageAtMs: 100 },
      { id: "justmade", lastMessageAtMs: null, createdAtMs: 500 },
    ]);
    assert.deepEqual(out.map((c) => c.id), ["justmade", "chatty"]);
  });

  test("does not mutate the input", () => {
    const input = [{ id: "a", lastMessageAtMs: 1 }, { id: "b", lastMessageAtMs: 2 }];
    byMostRecent(input);
    assert.deepEqual(input.map((c) => c.id), ["a", "b"]);
  });
});
