/**
 * What the app is allowed to believe about a text it tried to send.
 *
 * This is the rule that decides whether the lead-nurture cron gives back its
 * safety hold and lets a message be sent again. Getting it wrong in the
 * permissive direction texts a stranger the same thing twice; getting it wrong
 * in the cautious direction costs one lead a few days and leaves a line in the
 * run's report for somebody to clear. The tests below are written to that
 * asymmetry rather than to symmetry.
 *
 * It lives in lib/smsDelivery.ts, apart from lib/server/twilio.ts, for a
 * reason worth keeping written down: twilio.ts builds a client at module load
 * and cannot be imported without an account, so the rule was previously
 * "tested" by matching its source with a regex. That pinned a rule that was
 * wrong — an HTTP 503 was being called a rejection — and the regex passed.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { deliveryForFailure } = await import("../lib/smsDelivery.ts");

/** A Twilio REST exception, as the SDK throws it. */
const twilioError = (status, code) =>
  Object.assign(new Error(`Twilio error ${code}`), { status, code });

describe("a refusal is only a refusal when nothing was delivered", () => {
  test("a bad phone number is a rejection", () => {
    // 21211, HTTP 400: Twilio read the request, refused it, sent nothing.
    assert.equal(deliveryForFailure(twilioError(400, 21211)), "rejected");
  });

  test("a recipient who has blocked the sender is a rejection", () => {
    assert.equal(deliveryForFailure(twilioError(400, 21610)), "rejected");
  });

  test("bad credentials are a rejection", () => {
    assert.equal(deliveryForFailure(twilioError(401, 20003)), "rejected");
  });

  test("a number the account does not own is a rejection", () => {
    // The error Nick actually hit: 21212, From not owned by the account.
    assert.equal(deliveryForFailure(twilioError(400, 21212)), "rejected");
  });

  test("being rate limited is a rejection", () => {
    // 429: not accepted, and that is definite. Nothing went out.
    assert.equal(deliveryForFailure(twilioError(429, 20429)), "rejected");
  });
});

describe("a server error proves nothing", () => {
  // The bug this file was written for. A numeric status was treated as proof
  // that Twilio had refused, so a 503 released the hold and resent a message
  // that may well have been queued — and did not count against the run's send
  // cap either. A server error is the most likely failure during exactly the
  // kind of outage where resending everything does the most damage.
  test("a 500 is unknown", () => {
    assert.equal(deliveryForFailure(twilioError(500, 20500)), "unknown");
  });

  test("a 502 is unknown", () => {
    assert.equal(deliveryForFailure(twilioError(502)), "unknown");
  });

  test("a 503 is unknown", () => {
    assert.equal(deliveryForFailure(twilioError(503, 20503)), "unknown");
  });

  test("a 504 is unknown", () => {
    assert.equal(deliveryForFailure(twilioError(504)), "unknown");
  });
});

describe("a failure in transit proves nothing either", () => {
  test("a timeout is unknown", () => {
    assert.equal(deliveryForFailure(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), "unknown");
  });

  test("a dropped connection is unknown", () => {
    assert.equal(deliveryForFailure(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })), "unknown");
  });

  test("a DNS failure is unknown", () => {
    assert.equal(deliveryForFailure(Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" })), "unknown");
  });

  test("a plain error with nothing on it is unknown", () => {
    assert.equal(deliveryForFailure(new Error("something went wrong")), "unknown");
  });

  test("a non-numeric status is unknown", () => {
    // A string status is unrecognised, so nothing is claimed about it.
    assert.equal(deliveryForFailure(Object.assign(new Error("x"), { status: "400" })), "unknown");
  });

  test("a thrown string is unknown", () => {
    assert.equal(deliveryForFailure("boom"), "unknown");
  });

  test("a thrown null is unknown", () => {
    assert.equal(deliveryForFailure(null), "unknown");
    assert.equal(deliveryForFailure(undefined), "unknown");
  });
});

describe("the edges of the rejected range", () => {
  // Pinned because the range is the whole rule, and an off-by-one at either
  // end turns an uncertain failure into a licence to resend.
  test("399 is not a rejection", () => {
    assert.equal(deliveryForFailure(twilioError(399)), "unknown");
  });

  test("400 is", () => {
    assert.equal(deliveryForFailure(twilioError(400)), "rejected");
  });

  test("499 is", () => {
    assert.equal(deliveryForFailure(twilioError(499)), "rejected");
  });

  test("500 is not", () => {
    assert.equal(deliveryForFailure(twilioError(500)), "unknown");
  });

  test("a Twilio error code without a status claims nothing", () => {
    // The old rule accepted a bare `code` as proof the service had answered.
    // It is not: the SDK sets a code on some transport failures too.
    assert.equal(deliveryForFailure(Object.assign(new Error("x"), { code: 21211 })), "unknown");
  });
});
