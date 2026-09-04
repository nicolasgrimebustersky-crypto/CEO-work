/**
 * What a customer may send back about their own quote.
 *
 * This is the only writeable surface in the app with no signed-in person in
 * front of it, so these tests are less about happy paths than about what the
 * open internet can put in each field.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  MAX_MESSAGE_CHARS,
  MAX_NAME_CHARS,
  MAX_SIGNATURE_BYTES,
  MAX_DAYS_AHEAD,
  cleanName,
  cleanRequestedDate,
  cleanSignature,
  isDecision,
  todayIn,
  validateQuoteResponse,
} = await import("../lib/quoteResponse.ts");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const TODAY = "2026-09-04";

const approval = (over = {}) => ({
  decision: "accepted",
  signedName: "Ada Lovelace",
  signature: PNG,
  requestedDate: "2026-09-06", // a Sunday, on purpose
  ...over,
});

describe("the decision itself", () => {
  test("only the two we know about", () => {
    assert.equal(isDecision("accepted"), true);
    assert.equal(isDecision("declined"), true);
    for (const bad of ["ACCEPTED", "maybe", "", null, 1, {}]) {
      assert.equal(isDecision(bad), false, `accepted ${JSON.stringify(bad)}`);
    }
  });

  test("a missing decision is refused in words a customer can act on", () => {
    const out = validateQuoteResponse({ decision: "" }, TODAY);
    assert.equal(out.ok, false);
    assert.match(out.problem, /approving/i);
  });
});

describe("signatures", () => {
  test("a PNG data URL passes", () => {
    assert.equal(cleanSignature(PNG), PNG);
  });

  test("SVG is refused, because a signature is a picture and not a script", () => {
    // An <svg> data URL can carry script that runs whenever the crew open the
    // document. There is no version of a drawn line that needs to execute.
    assert.equal(cleanSignature("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), "");
  });

  test("other image types and plain URLs are refused", () => {
    for (const bad of [
      "data:image/jpeg;base64,/9j/4AAQ",
      "https://example.com/signature.png",
      "javascript:alert(1)",
      "data:text/html;base64,PGgxPjwvaDE+",
      PNG.replace("base64,", "base64,<>"),
      "",
      null,
      42,
    ]) {
      assert.equal(cleanSignature(bad), "", `accepted ${String(bad).slice(0, 40)}`);
    }
  });

  test("an oversized signature is refused rather than truncated", () => {
    // Truncating produces a corrupt image that renders as a broken box on the
    // one document somebody may later need to rely on.
    const huge = `data:image/png;base64,${"A".repeat(MAX_SIGNATURE_BYTES)}`;
    assert.equal(cleanSignature(huge), "");
  });
});

describe("the typed name", () => {
  test("whitespace is collapsed and the name kept", () => {
    assert.equal(cleanName("  Ada   Lovelace \n"), "Ada Lovelace");
  });

  test("a long name is capped, not refused", () => {
    assert.equal(cleanName("x".repeat(500)).length, MAX_NAME_CHARS);
  });

  test("approving without a name is refused", () => {
    const out = validateQuoteResponse(approval({ signedName: " " }), TODAY);
    assert.equal(out.ok, false);
    assert.match(out.problem, /type your name/i);
  });

  test("approving without a drawn line is refused", () => {
    const out = validateQuoteResponse(approval({ signature: "" }), TODAY);
    assert.equal(out.ok, false);
    assert.match(out.problem, /draw your signature/i);
  });
});

describe("the date the customer asks for", () => {
  test("today is allowed", () => {
    assert.equal(cleanRequestedDate(TODAY, TODAY), TODAY);
  });

  test("weekends are allowed, because the crew work them", () => {
    assert.equal(cleanRequestedDate("2026-09-05", TODAY), "2026-09-05"); // Saturday
    assert.equal(cleanRequestedDate("2026-09-06", TODAY), "2026-09-06"); // Sunday
  });

  test("yesterday is not", () => {
    assert.equal(cleanRequestedDate("2026-09-03", TODAY), "");
  });

  test("a date that matches the pattern but is not a real day is refused", () => {
    for (const bad of ["2026-13-01", "2026-02-31", "2026-00-10", "2026-09-00"]) {
      assert.equal(cleanRequestedDate(bad, TODAY), "", `accepted ${bad}`);
    }
  });

  test("junk shapes are refused", () => {
    for (const bad of ["04/09/2026", "next tuesday", "2026-9-4", "", null, {}]) {
      assert.equal(cleanRequestedDate(bad, TODAY), "", `accepted ${JSON.stringify(bad)}`);
    }
  });

  test("the far future is refused", () => {
    assert.equal(cleanRequestedDate("2030-01-01", TODAY), "");
  });

  test("the boundary is inclusive at the limit and exclusive past it", () => {
    const at = new Date(Date.UTC(2026, 8, 4) + MAX_DAYS_AHEAD * 86400000)
      .toISOString()
      .slice(0, 10);
    const past = new Date(Date.UTC(2026, 8, 4) + (MAX_DAYS_AHEAD + 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    assert.equal(cleanRequestedDate(at, TODAY), at);
    assert.equal(cleanRequestedDate(past, TODAY), "");
  });
});

describe("declining", () => {
  test("needs nothing at all", () => {
    // Somebody who wants to say no and walk away must be able to.
    const out = validateQuoteResponse({ decision: "declined" }, TODAY);
    assert.equal(out.ok, true);
    assert.equal(out.value.decision, "declined");
    assert.equal(out.value.message, "");
  });

  test("carries a question when there is one", () => {
    const out = validateQuoteResponse(
      { decision: "declined", message: "  Is the back patio  included? " },
      TODAY,
    );
    assert.equal(out.ok, true);
    assert.equal(out.value.message, "Is the back patio included?");
  });

  test("a signature sent with a decline is dropped, not stored", () => {
    // Nothing was agreed to, so nothing should carry a signature.
    const out = validateQuoteResponse(
      { decision: "declined", signature: PNG, signedName: "Ada" },
      TODAY,
    );
    assert.equal(out.ok, true);
    assert.equal(out.value.signature, "");
    assert.equal(out.value.signedName, "");
  });

  test("a very long message is capped", () => {
    const out = validateQuoteResponse(
      { decision: "declined", message: "x".repeat(5000) },
      TODAY,
    );
    assert.equal(out.ok, true);
    assert.equal(out.value.message.length, MAX_MESSAGE_CHARS);
  });
});

describe("a complete approval", () => {
  test("comes back cleaned", () => {
    const out = validateQuoteResponse(approval({ message: " see you then " }), TODAY);
    assert.equal(out.ok, true);
    assert.deepEqual(out.value, {
      decision: "accepted",
      signedName: "Ada Lovelace",
      signature: PNG,
      requestedDate: "2026-09-06",
      message: "see you then",
    });
  });
});

describe("today, in one timezone", () => {
  test("is the Kentucky date, not the UTC one", () => {
    // 01:30 UTC on the 5th is still the evening of the 4th in Louisville. A
    // customer tapping today's date at that hour must not be told it is past.
    const lateEvening = new Date("2026-09-05T01:30:00Z");
    assert.equal(todayIn("America/New_York", lateEvening), "2026-09-04");
    assert.equal(todayIn("UTC", lateEvening), "2026-09-05");
  });
});
