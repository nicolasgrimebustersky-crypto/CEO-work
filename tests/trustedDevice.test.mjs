/**
 * The rules that decide whether a phone may skip the sign-in code.
 *
 * This is the only code in the app that can grant the `otpAuths` claim without
 * somebody typing six digits, so the tests are weighted entirely towards the
 * refusals. A false "yes" here is a stranger with a password reading the
 * customer book; a false "no" costs one typed code.
 *
 * The security rules are deliberately NOT changed by this feature, and the
 * last test in this file is the one that proves it — `hasVerifiedSession()`
 * still requires the claim, so every path to the data still runs through it.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";

import {
  TRUST_DAYS,
  TRUST_MS,
  TRUST_STORAGE_KEY,
  checkTrust,
  composeToken,
  daysLeft,
  deviceLabel,
  expiryFrom,
  parseToken,
} from "../lib/trustedDevice.ts";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const DAY = 86_400_000;

const record = (over = {}) => ({
  uid: "alice",
  expiresAtMs: NOW + 10 * DAY,
  revoked: false,
  ...over,
});

describe("a token is only a token if it is exactly the right shape", () => {
  const good = composeToken({ id: "a".repeat(22), secret: "b".repeat(43) });

  test("a well-formed one round-trips", () => {
    const parsed = parseToken(good);
    assert.ok(parsed);
    assert.equal(parsed.id, "a".repeat(22));
    assert.equal(parsed.secret, "b".repeat(43));
  });

  test("anything that is not a two-part string is refused", () => {
    for (const bad of [
      null,
      undefined,
      42,
      {},
      [],
      "",
      "   ",
      "noseparator",
      "too.many.parts",
      `.${"b".repeat(43)}`,
      `${"a".repeat(22)}.`,
    ]) {
      assert.equal(parseToken(bad), null, `accepted ${JSON.stringify(bad)}`);
    }
  });

  test("a short secret is refused — length is the entropy", () => {
    assert.equal(parseToken(`${"a".repeat(22)}.short`), null);
    assert.equal(parseToken(`${"a".repeat(22)}.${"b".repeat(31)}`), null);
    assert.ok(parseToken(`${"a".repeat(22)}.${"b".repeat(32)}`), "32 is the floor");
  });

  test("characters outside the generated alphabet are refused", () => {
    // base64url is [A-Za-z0-9_-]. A token carrying anything else did not come
    // from issueTrustedDevice, so it is tampering, not a near miss.
    assert.equal(parseToken(`${"a".repeat(22)}.${"b".repeat(42)}+`), null);
    assert.equal(parseToken(`${"a".repeat(22)}.${"b".repeat(42)}/`), null);
    assert.equal(parseToken(`${"a/".repeat(11)}.${"b".repeat(43)}`), null);
  });

  test("surrounding whitespace is forgiven, because storage round-trips add it", () => {
    assert.ok(parseToken(`  ${good}\n`));
  });
});

describe("the refusal ladder", () => {
  test("a good record on the right account, in date, passes", () => {
    assert.deepEqual(checkTrust(record(), "alice", NOW), { ok: true });
  });

  test("no record at all is refused", () => {
    assert.deepEqual(checkTrust(null, "alice", NOW), { ok: false, reason: "unknown" });
  });

  test("a token belonging to another account is refused", () => {
    // The case that matters most: two crew on one handset, or a token lifted
    // from somebody else's browser.
    assert.deepEqual(checkTrust(record({ uid: "bob" }), "alice", NOW), {
      ok: false,
      reason: "wrong-account",
    });
  });

  test("a revoked device is refused even though it has not expired", () => {
    assert.deepEqual(checkTrust(record({ revoked: true }), "alice", NOW), {
      ok: false,
      reason: "revoked",
    });
  });

  test("an expired device is refused", () => {
    assert.deepEqual(checkTrust(record({ expiresAtMs: NOW - 1 }), "alice", NOW), {
      ok: false,
      reason: "expired",
    });
  });

  test("expiring exactly now counts as expired", () => {
    // The direction a boundary has to fail in.
    assert.equal(checkTrust(record({ expiresAtMs: NOW }), "alice", NOW).ok, false);
    assert.equal(checkTrust(record({ expiresAtMs: NOW + 1 }), "alice", NOW).ok, true);
  });

  test("wrong account beats revoked and expired", () => {
    // Somebody holding a stolen token must not learn that it is live
    // elsewhere, so the least informative refusal has to win.
    const stolen = record({ uid: "bob", revoked: true, expiresAtMs: NOW - DAY });
    assert.equal(checkTrust(stolen, "alice", NOW).reason, "wrong-account");
  });

  test("a record with a missing expiry is refused, not treated as forever", () => {
    // A document written by an older version, or with the field lost, reads as
    // 0 at the boundary — which must mean expired rather than eternal.
    assert.equal(checkTrust(record({ expiresAtMs: 0 }), "alice", NOW).ok, false);
  });
});

describe("the clock", () => {
  test("trust runs for exactly the advertised number of days", () => {
    assert.equal(TRUST_DAYS, 30);
    assert.equal(TRUST_MS, 30 * DAY);
    assert.equal(expiryFrom(NOW) - NOW, 30 * DAY);
  });

  test("a device issued now is still good on day 29 and dead on day 31", () => {
    const expiry = expiryFrom(NOW);
    assert.equal(checkTrust(record({ expiresAtMs: expiry }), "alice", NOW + 29 * DAY).ok, true);
    assert.equal(checkTrust(record({ expiresAtMs: expiry }), "alice", NOW + 31 * DAY).ok, false);
  });

  test("days left floors, and never goes negative", () => {
    assert.equal(daysLeft(NOW + 10 * DAY, NOW), 10);
    assert.equal(daysLeft(NOW + 10 * DAY - 1, NOW), 9, "part of a day is not a day");
    assert.equal(daysLeft(NOW - 5 * DAY, NOW), 0, "already gone reads as 0, not -5");
  });
});

describe("the device label", () => {
  test("names the handsets this business actually uses", () => {
    assert.match(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) ... Safari/604.1"), /iPhone/);
    assert.match(deviceLabel("Mozilla/5.0 (Linux; Android 14) ... Chrome/130"), /Android/);
  });

  test("an unreadable or missing agent still produces a sentence", () => {
    for (const ua of [null, undefined, "", 42, {}]) {
      assert.equal(typeof deviceLabel(ua), "string");
      assert.ok(deviceLabel(ua).length > 0, `empty label for ${JSON.stringify(ua)}`);
    }
  });

  test("it is coarse on purpose — no versions, no fingerprint", () => {
    const label = deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1");
    assert.doesNotMatch(label, /\d/, `label carries version digits: ${label}`);
    assert.ok(label.length < 40, label);
  });
});

describe("the storage key is scoped", () => {
  test("it is versioned, so a format change cannot be read as the old one", () => {
    assert.match(TRUST_STORAGE_KEY, /\.v\d+$/);
  });
});

describe("this feature does not weaken the security rules", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

  test("hasVerifiedSession still demands the claim for this very sign-in", () => {
    // The whole safety argument rests on this being unchanged: a trusted
    // device changes HOW the claim is earned, never whether it is required.
    assert.match(rules, /function hasVerifiedSession\(\)/);
    assert.match(rules, /request\.auth\.token\.auth_time in request\.auth\.token\.otpAuths/);
  });

  test("isCrew still runs every caller through it", () => {
    const at = rules.indexOf("function isCrew()");
    assert.notEqual(at, -1);
    const body = rules.slice(at, rules.indexOf("}", at));
    assert.match(body, /hasVerifiedSession\(\)/);
  });

  test("the trustedDevices collection has no rule, so no client can touch it", () => {
    // Rules deny by default. A match block appearing here later would be the
    // thing to stop, which is why this asserts its absence rather than trusting
    // that nobody adds one.
    assert.doesNotMatch(rules, /match \/trustedDevices\//);
  });
});
