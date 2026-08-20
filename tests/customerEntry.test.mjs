/**
 * Typing somebody into the book by hand.
 *
 * The rules here are about one thing: a record that can be found again. The map
 * flow guaranteed that by construction — every pin had a location. A typed-in
 * record has no such guarantee, so the validation has to supply it.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

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
