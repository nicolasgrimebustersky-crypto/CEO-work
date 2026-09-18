/**
 * The webhook signature check.
 *
 * This is the boundary: the endpoint it guards is publicly reachable by
 * definition, and behind it is code that writes payments into the ledger.
 * Without this check anybody who can send an HTTP request can mark any invoice
 * paid. So the tests here are adversarial rather than illustrative — a forged
 * signature, a replayed body, a tampered payload, a rotated secret, and the
 * malformed headers that a naive parser treats as valid.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test, describe } from "node:test";

const { verifyStripeSignature, parseSignatureHeader, REPLAY_TOLERANCE_MS } = await import(
  "../lib/stripeSignature.ts"
);

const SECRET = "whsec_testsecret";
const BODY = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
const NOW = 1_800_000_000_000;

function sign(body = BODY, secret = SECRET, atMs = NOW) {
  const seconds = Math.floor(atMs / 1000);
  const digest = createHmac("sha256", secret).update(`${seconds}.${body}`, "utf8").digest("hex");
  return `t=${seconds},v1=${digest}`;
}

describe("a genuine webhook", () => {
  test("passes", () => {
    assert.deepEqual(verifyStripeSignature(BODY, sign(), SECRET, NOW), { ok: true, problem: "" });
  });

  test("passes at the edge of the replay window", () => {
    const header = sign(BODY, SECRET, NOW - REPLAY_TOLERANCE_MS + 1000);
    assert.equal(verifyStripeSignature(BODY, header, SECRET, NOW).ok, true);
  });

  test("passes during a secret rotation, when several v1 values are sent", () => {
    const seconds = Math.floor(NOW / 1000);
    const real = createHmac("sha256", SECRET).update(`${seconds}.${BODY}`, "utf8").digest("hex");
    const stale = "a".repeat(64);
    assert.equal(verifyStripeSignature(BODY, `t=${seconds},v1=${stale},v1=${real}`, SECRET, NOW).ok, true);
  });
});

describe("what must be rejected", () => {
  test("a body tampered with after signing", () => {
    const header = sign();
    const tampered = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_EVIL" } } });
    assert.equal(verifyStripeSignature(tampered, header, SECRET, NOW).ok, false);
  });

  test("a signature made with the wrong secret", () => {
    const forged = sign(BODY, "whsec_attacker", NOW);
    const result = verifyStripeSignature(BODY, forged, SECRET, NOW);
    assert.equal(result.ok, false);
    assert.match(result.problem, /does not match/i);
  });

  test("a replayed body from outside the window", () => {
    const header = sign(BODY, SECRET, NOW - REPLAY_TOLERANCE_MS - 1000);
    const result = verifyStripeSignature(BODY, header, SECRET, NOW);
    assert.equal(result.ok, false);
    assert.match(result.problem, /replay window/i);
  });

  test("a timestamp in the future, which would reopen that window", () => {
    const header = sign(BODY, SECRET, NOW + REPLAY_TOLERANCE_MS + 1000);
    assert.equal(verifyStripeSignature(BODY, header, SECRET, NOW).ok, false);
  });

  test("an edited timestamp — it is part of what is signed", () => {
    const header = sign().replace(/^t=\d+/, `t=${Math.floor(NOW / 1000) + 1}`);
    assert.equal(verifyStripeSignature(BODY, header, SECRET, NOW).ok, false);
  });

  test("no secret configured, even with a well-formed header", () => {
    const result = verifyStripeSignature(BODY, sign(), "", NOW);
    assert.equal(result.ok, false);
    assert.match(result.problem, /secret/i);
  });

  test("missing, empty and malformed headers", () => {
    for (const header of ["", "garbage", "t=,v1=", "v1=abc", "t=123", "t=abc,v1=def", ",,,"]) {
      assert.equal(verifyStripeSignature(BODY, header, SECRET, NOW).ok, false, `header: ${header}`);
    }
  });

  test("a non-hex signature does not throw", () => {
    const seconds = Math.floor(NOW / 1000);
    for (const v1 of ["zzzz", "!!!!", " "]) {
      assert.doesNotThrow(() => verifyStripeSignature(BODY, `t=${seconds},v1=${v1}`, SECRET, NOW));
      assert.equal(verifyStripeSignature(BODY, `t=${seconds},v1=${v1}`, SECRET, NOW).ok, false);
    }
  });

  test("a signature of the right length but wrong value", () => {
    const seconds = Math.floor(NOW / 1000);
    assert.equal(verifyStripeSignature(BODY, `t=${seconds},v1=${"0".repeat(64)}`, SECRET, NOW).ok, false);
  });

  test("an empty body signed elsewhere is not accepted for a real body", () => {
    assert.equal(verifyStripeSignature(BODY, sign("", SECRET, NOW), SECRET, NOW).ok, false);
  });
});

describe("parsing the header", () => {
  test("reads the timestamp as milliseconds and collects every v1", () => {
    const parsed = parseSignatureHeader("t=1700000000,v1=aa,v1=BB,v0=cc");
    assert.equal(parsed.timestampMs, 1_700_000_000_000);
    // Case-normalised, and v0 (Stripe's older scheme) deliberately ignored.
    assert.deepEqual(parsed.signatures, ["aa", "bb"]);
  });

  test("tolerates whitespace around the parts", () => {
    const parsed = parseSignatureHeader(" t=1700000000 , v1=aa ");
    assert.equal(parsed.timestampMs, 1_700_000_000_000);
    assert.deepEqual(parsed.signatures, ["aa"]);
  });

  test("returns null rather than a half-parsed header", () => {
    for (const header of ["", "t=1700000000", "v1=aa", "t=x,v1=aa", "nonsense"]) {
      assert.equal(parseSignatureHeader(header), null, `header: ${header}`);
    }
  });
});
