/**
 * Who the customer portal lets in, and to whose records.
 *
 * This module is the portal's entire security boundary, so the tests are
 * adversarial rather than illustrative. The cases that matter are the ones
 * where a lookup quietly matches somebody it should not: an empty stored field
 * equalling an empty identity, a half-typed number normalising onto a real one,
 * an unverified email being treated as proof, and a sequential document number
 * being guessed to claim a stranger's account.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  phoneKey,
  emailKey,
  verifiedIdentity,
  isAnonymous,
  recordBelongsTo,
  claimMatches,
  MAX_RECORDS_PER_IDENTITY,
} = await import("../lib/portalMatch.ts");

const { toE164 } = await import("../lib/format.ts");

describe("normalising a phone number", () => {
  test("the shapes a number is actually typed in all reach one key", () => {
    for (const written of [
      "(502) 555-0100",
      "502-555-0100",
      "502.555.0100",
      "5025550100",
      "15025550100",
      "+1 502 555 0100",
      "  (502) 555-0100  ",
    ]) {
      assert.equal(phoneKey(written), "+15025550100", `from: ${written}`);
    }
  });

  test("agrees with toE164, which is what Twilio texts", () => {
    // Two normalisations that disagree means a customer who gets our texts
    // cannot sign in with the number those texts went to.
    for (const written of ["(502) 555-0100", "5025550100", "15025550100"]) {
      assert.equal(phoneKey(written), toE164(written));
    }
  });

  test("a half-typed number is refused, never padded onto a real one", () => {
    for (const partial of ["502555", "5025550", "502", "1", "+1", ""]) {
      assert.equal(phoneKey(partial), null, `from: ${partial}`);
    }
  });

  test("things that are not numbers are refused", () => {
    for (const value of [null, undefined, "abc", "+abc", "+", "not a phone"]) {
      assert.equal(phoneKey(value), null, `from: ${value}`);
    }
  });
});

describe("normalising an email", () => {
  test("case and whitespace do not make a different person", () => {
    assert.equal(emailKey("  Marta@Example.COM "), "marta@example.com");
  });

  test("anything that is not an address is refused", () => {
    for (const value of [null, undefined, "", "   ", "marta", "@"]) {
      assert.equal(emailKey(value), null, `from: ${value}`);
    }
  });
});

describe("what a Firebase token actually proves", () => {
  test("a verified email counts", () => {
    const id = verifiedIdentity({ email: "Marta@Example.com", email_verified: true });
    assert.equal(id.email, "marta@example.com");
    assert.equal(id.phone, null);
  });

  test("an UNVERIFIED email proves nothing — this is the whole point", () => {
    // Anybody can type an address at signup. Without the flag, typing a
    // customer's address would hand over their invoices.
    const id = verifiedIdentity({ email: "marta@example.com", email_verified: false });
    assert.equal(id.email, null);
    assert.equal(isAnonymous(id), true);
  });

  test("a missing email_verified flag is not a yes", () => {
    for (const flag of [undefined, null, "true", 1]) {
      assert.equal(verifiedIdentity({ email: "m@e.com", email_verified: flag }).email, null);
    }
  });

  test("a phone number on the token is verified by construction", () => {
    const id = verifiedIdentity({ phone_number: "+15025550100" });
    assert.equal(id.phone, "+15025550100");
  });

  test("a token proving neither is anonymous", () => {
    assert.equal(isAnonymous(verifiedIdentity({})), true);
    assert.equal(isAnonymous(verifiedIdentity({ email: "x@y.com" })), true);
  });
});

describe("matching a record to a verified identity", () => {
  const identity = { email: "marta@example.com", phone: "+15025550100" };

  test("matches on either email or phone", () => {
    assert.equal(recordBelongsTo({ email: "marta@example.com" }, identity), true);
    assert.equal(recordBelongsTo({ phoneE164: "+15025550100" }, identity), true);
    assert.equal(recordBelongsTo({ phone: "(502) 555-0100" }, identity), true);
  });

  test("a record written before phoneE164 existed still matches on the typed field", () => {
    assert.equal(recordBelongsTo({ phone: "502-555-0100" }, identity), true);
  });

  test("somebody else's record does not match", () => {
    assert.equal(recordBelongsTo({ email: "rob@example.com" }, identity), false);
    assert.equal(recordBelongsTo({ phoneE164: "+15025559999" }, identity), false);
  });

  test("an EMPTY record matches nothing — the classic hand-over-the-database bug", () => {
    for (const record of [
      {},
      { email: "" },
      { phone: "" },
      { email: "", phone: "", phoneE164: "" },
      { email: null, phone: null, phoneE164: null },
    ]) {
      assert.equal(recordBelongsTo(record, identity), false, `record: ${JSON.stringify(record)}`);
    }
  });

  test("an anonymous identity matches nothing, however full the record", () => {
    const anonymous = { email: null, phone: null };
    assert.equal(
      recordBelongsTo({ email: "marta@example.com", phoneE164: "+15025550100" }, anonymous),
      false,
    );
  });

  test("an identity with only a phone does not match on a stray email", () => {
    const phoneOnly = { email: null, phone: "+15025550100" };
    assert.equal(recordBelongsTo({ email: "marta@example.com" }, phoneOnly), false);
    assert.equal(recordBelongsTo({ phoneE164: "+15025550100" }, phoneOnly), true);
  });

  test("the record ceiling is a real bound", () => {
    assert.ok(MAX_RECORDS_PER_IDENTITY > 1, "a commercial customer has several sites");
    assert.ok(MAX_RECORDS_PER_IDENTITY <= 50, "and not an unbounded slice of the table");
  });
});

describe("claiming a document, where the number is guessable", () => {
  const target = { number: "EST-1042", total: 420.15 };

  test("the number and the total together", () => {
    assert.equal(claimMatches({ number: "EST-1042", total: 420.15 }, target), true);
  });

  test("case and stray spaces do not defeat a genuine claim", () => {
    assert.equal(claimMatches({ number: " est-1042 ", total: 420.15 }, target), true);
    assert.equal(claimMatches({ number: "EST 1042", total: 420.15 }, target), true);
  });

  test("the right number with the WRONG total is refused — the guessing attack", () => {
    // Numbers are sequential: knowing EST-1042 exists tells you EST-1041 does.
    // The total is what an attacker walking the sequence does not have.
    for (const total of [420, 420.14, 421, 0, 99999]) {
      assert.equal(claimMatches({ number: "EST-1042", total }, target), false, `total: ${total}`);
    }
  });

  test("the right total with the wrong number is refused", () => {
    assert.equal(claimMatches({ number: "EST-1041", total: 420.15 }, target), false);
  });

  test("the real stored number format — bare digits, shown as #8904", () => {
    // nextNumber() returns String(n) and DocumentPaper prints "#{number}", so
    // the stored value is "8904". Customers copy what they see, and the first
    // version of the claim form asked for "EST-1042" and matched verbatim,
    // which meant the flow could not have succeeded for anybody.
    const real = { number: "8904", total: 420.15 };
    for (const typed of ["8904", "#8904", " 8904 ", "#8904 ", "EST 8904", "est-8904"]) {
      assert.equal(claimMatches({ number: typed, total: 420.15 }, real), true, `typed: ${typed}`);
    }
  });

  test("an empty or nonsense claim is refused", () => {
    for (const attempt of [
      { number: "", total: 420.15 },
      { number: "   ", total: 420.15 },
      { number: "EST-1042", total: Number.NaN },
      { number: "EST-1042", total: Number.POSITIVE_INFINITY },
    ]) {
      assert.equal(claimMatches(attempt, target), false, `attempt: ${JSON.stringify(attempt)}`);
    }
  });

  test("a zero total never satisfies a claim", () => {
    // The hole this closes: parsing an empty or non-numeric total as 0 would
    // make any zero-total document claimable on its guessable number alone.
    assert.equal(claimMatches({ number: "8904", total: 0 }, { number: "8904", total: 0 }), true);
    assert.equal(claimMatches({ number: "8904", total: 0 }, { number: "8904", total: 420.15 }), false);
  });

  test("a cent of tolerance, because the figure is read off paper", () => {
    assert.equal(claimMatches({ number: "EST-1042", total: 420.1501 }, target), true);
    assert.equal(claimMatches({ number: "EST-1042", total: 420.16 }, target), false);
  });
});
