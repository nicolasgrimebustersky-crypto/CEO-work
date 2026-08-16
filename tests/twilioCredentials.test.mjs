/**
 * Tests for which Twilio credential gets used.
 *
 * Every failure mode here is silent, which is why it is worth pinning:
 *
 *   Pick the wrong credential and texts fail with a 401 nobody sees until a
 *   customer says they never got their confirmation.
 *
 *   Report `canVerify` true when it is not, and the inbound webhook accepts
 *   forged messages — anyone who guesses the URL writes into a customer's
 *   timeline and buzzes both phones.
 *
 * The second is the one that matters most, so the permissive direction is
 * tested explicitly rather than inferred from the happy path.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { readTwilioCredentials, twilioSetupHint } = await import(
  "../lib/twilio/credentials.ts"
);

const ACCOUNT = "AC" + "0".repeat(32);
const KEY = "SK" + "1".repeat(32);
const NUMBER = "+15025550147";

const full = {
  TWILIO_ACCOUNT_SID: ACCOUNT,
  TWILIO_API_KEY_SID: KEY,
  TWILIO_API_KEY_SECRET: "a-secret",
  TWILIO_AUTH_TOKEN: "an-auth-token",
  TWILIO_PHONE_NUMBER: NUMBER,
};

/** `full` minus the named keys, so a test can say plainly what is *absent*. */
const without = (...keys) =>
  Object.fromEntries(Object.entries(full).filter(([key]) => !keys.includes(key)));

describe("choosing a credential", () => {
  test("the API key wins when both are set", () => {
    // If somebody went to the trouble of making a revocable credential, that is
    // the one to use.
    assert.equal(readTwilioCredentials(full).kind, "api-key");
  });

  test("the auth token is used when there is no API key", () => {
    const rest = without("TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET");
    assert.equal(readTwilioCredentials(rest).kind, "auth-token");
    assert.equal(readTwilioCredentials(rest).canSend, true);
  });

  test("an API key alone can send", () => {
    const creds = readTwilioCredentials(without("TWILIO_AUTH_TOKEN"));
    assert.equal(creds.kind, "api-key");
    assert.equal(creds.canSend, true);
  });

  test("half an API key is not an API key", () => {
    // A SID with no secret would otherwise be picked and fail to authenticate.
    const creds = readTwilioCredentials({ ...full, TWILIO_API_KEY_SECRET: "" });
    assert.equal(creds.kind, "auth-token");
  });

  test("nothing configured sends nothing", () => {
    const creds = readTwilioCredentials({});
    assert.equal(creds.kind, "none");
    assert.equal(creds.canSend, false);
  });
});

describe("verifying webhooks", () => {
  test("an API key cannot verify, however complete it is", () => {
    // The trap. Twilio signs with the account auth token and never with an API
    // key secret, so this must be false even though sending works fine.
    const creds = readTwilioCredentials(without("TWILIO_AUTH_TOKEN"));
    assert.equal(creds.canSend, true, "it should still send");
    assert.equal(creds.canVerify, false, "an API key cannot verify a signature");
  });

  test("the auth token can verify", () => {
    assert.equal(readTwilioCredentials(full).canVerify, true);
  });

  test("nothing configured verifies nothing", () => {
    assert.equal(readTwilioCredentials({}).canVerify, false);
    assert.equal(readTwilioCredentials({ TWILIO_AUTH_TOKEN: "" }).canVerify, false);
  });
});

describe("catching a paste in the wrong box", () => {
  test("an Account SID in the API key slot is called out", () => {
    // Easy mistake, and it would otherwise surface as a generic 401 from
    // Twilio hours later with nothing pointing at the cause.
    const creds = readTwilioCredentials({ ...full, TWILIO_API_KEY_SID: ACCOUNT });
    assert.match(twilioSetupHint(creds), /API key.*start with SK/);
  });

  test("an API key in the Account SID slot is called out", () => {
    const creds = readTwilioCredentials({ ...full, TWILIO_ACCOUNT_SID: KEY });
    assert.equal(creds.canSend, false);
    assert.match(twilioSetupHint(creds), /Account SID.*start with AC/);
  });

  test("whitespace around a pasted value does not break it", () => {
    const padded = Object.fromEntries(
      Object.entries(full).map(([key, value]) => [key, `  ${value}  `]),
    );
    const creds = readTwilioCredentials(padded);
    assert.equal(creds.canSend, true);
    assert.equal(creds.kind, "api-key");
  });
});

describe("what it tells you to go and fix", () => {
  test("names every missing piece", () => {
    const hint = twilioSetupHint(readTwilioCredentials({}));
    assert.match(hint, /TWILIO_ACCOUNT_SID/);
    assert.match(hint, /TWILIO_PHONE_NUMBER/);
    assert.match(hint, /TWILIO_AUTH_TOKEN/);
  });

  test("says nothing when there is nothing to say", () => {
    assert.equal(twilioSetupHint(readTwilioCredentials(full)), "");
  });

  test("a missing number alone is named alone", () => {
    const hint = twilioSetupHint(readTwilioCredentials(without("TWILIO_PHONE_NUMBER")));
    assert.match(hint, /TWILIO_PHONE_NUMBER/);
    assert.doesNotMatch(hint, /TWILIO_ACCOUNT_SID/);
  });
});
