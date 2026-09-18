/**
 * Selecting several records and deleting them.
 *
 * Two things here are worth testing and neither is cosmetic.
 *
 * The selection maths decides what gets destroyed, and the case that matters is
 * "select all" while a filter is on: it must mean the rows on screen, never the
 * whole collection. Getting that wrong deletes records the person never saw.
 *
 * The wording is the last thing read before an irreversible action, so the
 * count, the noun and the "what stays" line are asserted literally rather than
 * by shape. A confirmation that says "1 clients" is one somebody skims.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  toggleId,
  toggleAll,
  allVisibleChosen,
  selectionLabel,
  confirmCopy,
  clientDeleteNote,
  chunkIds,
  MAX_BATCH,
} = await import("../lib/bulkDelete.ts");

describe("ticking rows", () => {
  test("adds and removes", () => {
    assert.deepEqual(toggleId([], "a"), ["a"]);
    assert.deepEqual(toggleId(["a"], "a"), []);
    assert.deepEqual(toggleId(["a", "b"], "b"), ["a"]);
  });

  test("does not mutate what it was given", () => {
    const before = ["a"];
    toggleId(before, "b");
    assert.deepEqual(before, ["a"]);
  });
});

describe("select all, which must mean what is on screen", () => {
  test("ticks every visible row", () => {
    assert.deepEqual(toggleAll([], ["a", "b"]), ["a", "b"]);
  });

  test("a second press clears only the visible ones", () => {
    // The case that matters: "c" is selected but filtered out of view. Clearing
    // must not silently drop it, and must not silently keep it selected for a
    // delete either — it stays exactly as it was.
    assert.deepEqual(toggleAll(["a", "b", "c"], ["a", "b"]), ["c"]);
  });

  test("selecting all with something already ticked does not duplicate it", () => {
    assert.deepEqual(toggleAll(["a"], ["a", "b"]), ["a", "b"]);
  });

  test("an empty list is never 'all chosen'", () => {
    assert.equal(allVisibleChosen([], []), false);
    assert.equal(allVisibleChosen(["a"], []), false);
    assert.deepEqual(toggleAll(["a"], []), ["a"]);
  });

  test("allVisibleChosen tracks the visible rows only", () => {
    assert.equal(allVisibleChosen(["a", "b"], ["a", "b"]), true);
    assert.equal(allVisibleChosen(["a"], ["a", "b"]), false);
    assert.equal(allVisibleChosen(["a", "b", "c"], ["a", "b"]), true);
  });
});

describe("the count label", () => {
  test("singular, plural and none", () => {
    assert.equal(selectionLabel(0), "None selected");
    assert.equal(selectionLabel(1), "1 selected");
    assert.equal(selectionLabel(4), "4 selected");
  });
});

describe("what the confirmation says, read literally", () => {
  test("one invoice", () => {
    const copy = confirmCopy("invoice", 1);
    assert.equal(copy.title, "Delete this invoice?");
    assert.equal(copy.action, "Delete");
    assert.match(copy.body, /cannot be undone/);
  });

  test("several invoices name the count in the title and on the button", () => {
    const copy = confirmCopy("invoice", 6);
    assert.equal(copy.title, "Delete 6 invoices?");
    assert.equal(copy.action, "Delete 6");
    assert.match(copy.body, /6 invoices/);
  });

  test("clients and estimates pluralise the same way", () => {
    assert.equal(confirmCopy("client", 2).title, "Delete 2 clients?");
    assert.equal(confirmCopy("estimate", 3).title, "Delete 3 estimates?");
    assert.equal(confirmCopy("client", 1).title, "Delete this client?");
  });

  test("never says '1 clients'", () => {
    for (const kind of ["invoice", "estimate", "client"]) {
      const copy = confirmCopy(kind, 1);
      assert.doesNotMatch(copy.title, /1 \w+s\?/);
      assert.doesNotMatch(copy.body, /1 \w+s /);
    }
  });
});

describe("telling somebody what survives a client delete", () => {
  test("says the paperwork stays, and that the totals do not move", () => {
    const note = clientDeleteNote(3);
    assert.match(note, /3 documents stay/);
    assert.match(note, /money history/);
    assert.match(note, /don't change/);
  });

  test("singular reads correctly", () => {
    assert.match(clientDeleteNote(1), /1 document stay/);
  });

  test("a client with no paperwork gets no line at all", () => {
    // Explaining a consequence that is not happening is its own kind of wrong.
    assert.equal(clientDeleteNote(0), "");
    assert.equal(clientDeleteNote(-1), "");
  });
});

describe("splitting a big delete into batches", () => {
  test("stays under Firestore's ceiling", () => {
    const ids = Array.from({ length: 1201 }, (_, index) => `id-${index}`);
    const chunks = chunkIds(ids);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, MAX_BATCH);
    assert.equal(chunks[2].length, 201);
    assert.equal(chunks.flat().length, ids.length);
    // Order preserved, so a partial run leaves a comprehensible result.
    assert.equal(chunks.flat()[0], "id-0");
    assert.equal(chunks.flat().at(-1), "id-1200");
  });

  test("small and empty selections", () => {
    assert.deepEqual(chunkIds([]), []);
    assert.deepEqual(chunkIds(["a"]), [["a"]]);
  });

  test("exactly the ceiling is one batch, one more is two", () => {
    const exact = Array.from({ length: MAX_BATCH }, (_, i) => `x${i}`);
    assert.equal(chunkIds(exact).length, 1);
    assert.equal(chunkIds([...exact, "extra"]).length, 2);
  });

  test("a nonsense chunk size throws rather than looping forever", () => {
    assert.throws(() => chunkIds(["a"], 0), /at least 1/);
  });
});
