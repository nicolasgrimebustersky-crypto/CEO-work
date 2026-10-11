/**
 * Typing somebody into the book by hand.
 *
 * The rules here are about one thing: a record that can be found again. The map
 * flow guaranteed that by construction — every pin had a location. A typed-in
 * record has no such guarantee, so the validation has to supply it.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";

const {
  customerEntryProblem,
  entryLabel,
  isUsableEmail,
  isUsablePhone,
  willGeocode,
} = await import("../lib/customerEntry.ts");

const blank = { firstName: "", lastName: "", phone: "", email: "", address: "" };
const entry = (patch) => ({ ...blank, ...patch });

describe("what is enough to save", () => {
  test("a name alone is", () => {
    assert.equal(customerEntryProblem(entry({ firstName: "Marta" })), null);
  });

  test("a phone number alone is — a referral often arrives as just that", () => {
    assert.equal(customerEntryProblem(entry({ phone: "502-555-0100" })), null);
  });

  test("an address alone is", () => {
    assert.equal(customerEntryProblem(entry({ address: "88 Ridgemoor Way" })), null);
  });

  test("nothing at all is not", () => {
    // A blank row is not a lead. It is a line somebody scrolls past forever
    // without ever knowing who it was meant to be.
    assert.match(customerEntryProblem(blank), /at least a name, a phone number or an address/i);
  });

  test("whitespace is not content", () => {
    assert.match(
      customerEntryProblem(entry({ firstName: "  ", phone: " ", address: "   " })),
      /at least a name/i,
    );
  });

  test("a last name on its own still counts", () => {
    assert.equal(customerEntryProblem(entry({ lastName: "Oakley" })), null);
  });
});

describe("the phone number", () => {
  test("ten digits, however they were typed", () => {
    for (const shape of [
      "5025550100",
      "502-555-0100",
      "(502) 555-0100",
      "502.555.0100",
      "502 555 0100",
    ]) {
      assert.equal(isUsablePhone(shape), true, shape);
    }
  });

  test("with the country code", () => {
    assert.equal(isUsablePhone("+1 502 555 0100"), true);
    assert.equal(isUsablePhone("15025550100"), true);
  });

  test("too short or too long is caught before it is saved", () => {
    // A number that is wrong in the book is worse than a blank one — it gets
    // texted, silently fails, and the lead is never chased.
    for (const bad of ["5551234", "502555", "1234567890123", "2 502 555 0100"]) {
      assert.equal(isUsablePhone(bad), false, bad);
    }
  });

  test("a bad number is named as the problem", () => {
    assert.match(customerEntryProblem(entry({ phone: "5551234" })), /10 digits/);
  });

  test("but a blank one is fine when there is a name", () => {
    assert.equal(customerEntryProblem(entry({ firstName: "Marta", phone: "" })), null);
  });
});

describe("the email address", () => {
  test("blank is allowed", () => {
    assert.equal(isUsableEmail(""), true);
    assert.equal(isUsableEmail("   "), true);
  });

  test("ordinary addresses pass", () => {
    for (const good of ["bob@example.com", "a.b+c@mail.co.uk", "x@y.io"]) {
      assert.equal(isUsableEmail(good), true, good);
    }
  });

  test("the obvious mistakes are caught", () => {
    for (const bad of ["bobsmith.com", "bob@", "@example.com", "bob smith@x.com", "bob@x"]) {
      assert.equal(isUsableEmail(bad), false, bad);
    }
  });

  test("it is loose on purpose", () => {
    // Anything stricter rejects real addresses, and a field that rejects real
    // input teaches people to leave it blank — which loses more than a typo.
    assert.equal(isUsableEmail("weird!but#legal@example.com"), true);
  });
});

describe("what it is called before anybody names it", () => {
  test("the name when there is one", () => {
    assert.equal(entryLabel(entry({ firstName: "Marta", lastName: "Oakley" })), "Marta Oakley");
  });

  test("falls back through address, then phone", () => {
    assert.equal(entryLabel(entry({ address: "88 Ridgemoor Way" })), "88 Ridgemoor Way");
    assert.equal(entryLabel(entry({ phone: "502-555-0100" })), "502-555-0100");
  });

  test("never an empty string", () => {
    assert.equal(entryLabel(blank), "New lead");
  });
});

describe("whether the map can place it later", () => {
  test("an address means a pin will appear on its own", () => {
    // The record is saved with no coordinates and the map geocodes it later.
    // Somebody typing in a phone lead needs to be told that, or they will go
    // looking for a pin that is not there yet and assume the save failed.
    assert.equal(willGeocode(entry({ address: "88 Ridgemoor Way, La Grange KY" })), true);
  });

  test("a name and a phone number alone cannot be placed", () => {
    assert.equal(willGeocode(entry({ firstName: "Marta", phone: "5025550100" })), false);
    assert.equal(willGeocode(entry({ address: "   " })), false);
  });
});

describe("a note is appended, never written over the array", () => {
  /**
   * The server appends with FieldValue.arrayUnion from nine places — the
   * inbound-SMS webhook, the nurture cron, the blast, quote responses. The
   * client used to rewrite the whole notes array from its in-memory snapshot,
   * so any server note that landed in between was erased. The inbound reply is
   * the one that hurts: it is the only record that a customer wrote back.
   *
   * A comment in the file justified the rewrite on two grounds, and both are
   * answered elsewhere in the same file — makeNote gives every note a
   * randomUUID so arrayUnion's deep-equality dedup cannot bite, and asNotes
   * sorts on read so stored order never mattered.
   */
  const SOURCE = readFileSync(new URL("../lib/db/customers.ts", import.meta.url), "utf8");
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");

  test("no client writer rebuilds the notes array", () => {
    // The regression that would re-open it. Comments stripped first, because
    // this file's prose quotes the old expression to explain why it is gone.
    assert.doesNotMatch(
      code,
      /notes\s*[:=]\s*\[\.\.\.customer\.notes/,
      "a client write is rebuilding the whole notes array again — any note the " +
        "server appended since this snapshot would be erased",
    );
  });

  test("all three writers go through the one helper", () => {
    // addNote, changeStatus and setPipelineStage. setPipelineStage assigns
    // patch.notes rather than using an object literal, which is how it was
    // missed on the first pass through this file.
    const uses = code.match(/appendNote\(customer, note\)/g) ?? [];
    assert.equal(uses.length, 3, `expected 3 call sites, saw ${uses.length}`);
    for (const fn of ["addNote", "changeStatus", "setPipelineStage"]) {
      const at = code.indexOf(`function ${fn}`);
      assert.notEqual(at, -1, `${fn} not found`);
      const body = code.slice(at, at + 1400);
      assert.match(body, /appendNote\(customer, note\)/, `${fn} must append, not rewrite`);
    }
  });

  test("the helper uses arrayUnion outside demo mode", () => {
    const at = code.indexOf("function appendNote");
    const body = code.slice(at, code.indexOf("\n}", at));
    assert.match(body, /arrayUnion\(note\)/, "atomic append on the real path");
    assert.match(body, /isDemoMode/, "demo mode keeps the array form");
    assert.ok(
      body.indexOf("isDemoMode") < body.indexOf("arrayUnion"),
      "demo mode is the branch, not the fallback — lib/demo/store would " +
        "persist a FieldValue sentinel as an object",
    );
  });

  test("the server still appends atomically too", () => {
    // Both sides must agree. If the server ever went back to a rewrite, the
    // same race returns from the other direction.
    const server = readFileSync(
      new URL("../lib/server/customerNotes.ts", import.meta.url),
      "utf8",
    );
    assert.match(server, /notes: FieldValue\.arrayUnion\(/, "server appends atomically");
  });

  test("every note carries a unique id, which is what makes arrayUnion safe", () => {
    // arrayUnion de-duplicates by deep equality. That was the original
    // objection, and it only holds if two notes can be identical.
    assert.match(code, /randomUUID\(\)/, "notes are uniquely identified");
  });

  test("notes are sorted on read, which is why stored order does not matter", () => {
    // The other original objection.
    assert.match(
      code,
      /sort\(\(a, b\) => b\.createdAt\.toMillis\(\) - a\.createdAt\.toMillis\(\)\)/,
      "asNotes orders newest-first on the way in",
    );
  });
});
