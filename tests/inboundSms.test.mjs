/**
 * Texts from numbers we don't have on file.
 *
 * The bug these cover was a silent one: an inbound text from a number with no
 * matching customer was logged to the server console and dropped, so the only
 * evidence a customer had ever written was a line in a log nobody reads. The
 * tests below exist because that failure mode leaves no trace anywhere a person
 * would look, which is exactly the kind that comes back.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { phoneKey, formatPhone, groupUnmatched, unmatchedCount, suggestName } = await import(
  "../lib/inboundSms.ts"
);

/** Firestore's Timestamp, as much of it as this code touches. */
const at = (millis) => ({ toMillis: () => millis });

const msg = (id, from, body, millis, handled = false) => ({
  id,
  from,
  body,
  receivedAt: at(millis),
  handled,
});

describe("keying a phone number", () => {
  test("the same person, however the number is written", () => {
    const written = ["+15025550147", "15025550147", "5025550147", "(502) 555-0147", "502-555-0147"];
    const keys = new Set(written.map(phoneKey));
    assert.equal(keys.size, 1, `all of these are one person: ${[...keys].join(", ")}`);
    assert.equal([...keys][0], "5025550147");
  });

  test("anything that is not a ten-digit number keys to nothing", () => {
    for (const junk of ["", "   ", "abc", "911", "+44 20 7946 0958".slice(0, 6)]) {
      assert.equal(phoneKey(junk), "", JSON.stringify(junk));
    }
  });

  test("matches the server's own rule, which is the point", () => {
    // lib/server/customerNotes.ts findCustomerByPhone uses exactly this: strip
    // non-digits, take the last ten. If these two ever disagree a message can
    // be filed as unmatched while the customer sits in the list.
    const serverRule = (value) => value.replace(/\D/g, "").slice(-10);
    for (const value of ["+15025550147", "(502) 555-0147", "1-502-555-0147"]) {
      assert.equal(phoneKey(value), serverRule(value));
    }
  });
});

describe("showing a number to a person", () => {
  test("formatted the way it is read aloud", () => {
    assert.equal(formatPhone("+15025550147"), "(502) 555-0147");
  });

  test("something unformattable comes back as itself rather than mangled", () => {
    assert.equal(formatPhone("short code 22395"), "short code 22395");
    assert.equal(formatPhone(""), "");
  });
});

describe("grouping what came in", () => {
  test("three texts from one number are one person to call back", () => {
    const threads = groupUnmatched([
      msg("a", "+15025550147", "hi", 1000),
      msg("b", "+15025550147", "you there?", 2000),
      msg("c", "+15025550147", "never mind", 3000),
    ]);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].messages.length, 3);
  });

  test("the same person through two different spellings of their number", () => {
    const threads = groupUnmatched([
      msg("a", "+15025550147", "first", 1000),
      msg("b", "(502) 555-0147", "second", 2000),
    ]);
    assert.equal(threads.length, 1, "one person, not two");
  });

  test("messages read oldest first, threads newest first", () => {
    const threads = groupUnmatched([
      msg("old", "+15025550147", "yesterday", 1000),
      msg("new", "+15025559999", "just now", 5000),
      msg("mid", "+15025550147", "this morning", 2000),
    ]);
    assert.deepEqual(
      threads.map((t) => t.last.id),
      ["new", "mid"],
      "whoever wrote most recently is at the top",
    );
    assert.deepEqual(
      threads[1].messages.map((m) => m.id),
      ["old", "mid"],
      "a conversation reads forwards",
    );
  });

  test("handled messages drop out", () => {
    // Once the number is a customer the conversation lives on their timeline.
    // A copy here would be a second place for the same messages to live.
    const threads = groupUnmatched([
      msg("a", "+15025550147", "hi", 1000, true),
      msg("b", "+15025559999", "hello", 2000),
    ]);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].last.id, "b");
  });

  test("a fully handled inbox is empty, not a list of ghosts", () => {
    const threads = groupUnmatched([msg("a", "+15025550147", "hi", 1000, true)]);
    assert.deepEqual(threads, []);
    assert.equal(unmatchedCount(threads), 0);
  });

  test("an odd sender is kept rather than quietly dropped", () => {
    // Losing messages silently is the whole bug. Doing it again here, to the
    // ones that look strange, would be the same mistake wearing a hat.
    const threads = groupUnmatched([msg("a", "22395", "Your code is 1234", 1000)]);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].last.body, "Your code is 1234");
  });

  test("counts people, not messages", () => {
    const threads = groupUnmatched([
      msg("a", "+15025550147", "one", 1000),
      msg("b", "+15025550147", "two", 2000),
      msg("c", "+15025559999", "three", 3000),
    ]);
    assert.equal(unmatchedCount(threads), 2);
  });

  test("nothing in, nothing out", () => {
    assert.deepEqual(groupUnmatched([]), []);
  });
});

describe("guessing a name off the first text", () => {
  test("an explicit introduction is taken", () => {
    assert.deepEqual(suggestName("Hi this is Dave Whitfield, saw your truck on Bardstown Rd"), {
      firstName: "Dave",
      lastName: "Whitfield",
    });
    assert.deepEqual(suggestName("My name is Priya Nolan"), {
      firstName: "Priya",
      lastName: "Nolan",
    });
  });

  test("a first name on its own is still worth prefilling", () => {
    assert.deepEqual(suggestName("this is Ray"), { firstName: "Ray", lastName: "" });
  });

  test("no introduction means an empty form, not a guess", () => {
    // A customer called "Hey" in the database is worse than a blank field.
    for (const body of [
      "hey",
      "how much for a driveway",
      "",
      "STOP",
      "yes please book it in for tuesday",
    ]) {
      assert.deepEqual(suggestName(body), { firstName: "", lastName: "" }, JSON.stringify(body));
    }
  });

  test("a lowercase word after the phrase is not a name", () => {
    assert.deepEqual(suggestName("i'm interested in a quote"), { firstName: "", lastName: "" });
  });
});
