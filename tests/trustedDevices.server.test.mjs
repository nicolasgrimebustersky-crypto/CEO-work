/**
 * The trusted-device store, against a real Firestore.
 *
 * The pure ladder is covered by tests/trustedDevice.test.mjs, which can prove
 * every refusal by calling `checkTrust`. This covers the half that needs a
 * database: that the secret is never written down, that a tampered one is
 * refused, and that revoking actually stops a device that is otherwise
 * perfectly valid.
 *
 * The first of those is the one worth the emulator. "The secret is hashed" is
 * a claim about what is in the document, and no amount of calling the function
 * demonstrates it — only reading the row back does.
 *
 * Run by `npm run test:server`.
 */
import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";

import { fakeServiceAccountB64 } from "./helpers/fakeServiceAccount.mjs";

const PROJECT = process.env.VIEW_TEST_PROJECT ?? "demo-grimebusters-views";

assert.ok(
  process.env.FIRESTORE_EMULATOR_HOST,
  "FIRESTORE_EMULATOR_HOST is not set — run this through `npm run test:server`.",
);

process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountB64(PROJECT);

const {
  issueTrustedDevice,
  redeemTrustedDevice,
  listTrustedDevices,
  revokeAllTrustedDevices,
} = await import("@/lib/server/trustedDevices.ts");
const { parseToken, TRUST_MS } = await import("@/lib/trustedDevice.ts");
const { adminDb } = await import("@/lib/server/admin.ts");

const DEVICES = () => adminDb().collection("trustedDevices");
const NOW = Date.parse("2026-10-13T12:00:00Z");
const DAY = 86_400_000;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1";

beforeEach(async () => {
  const snap = await DEVICES().get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
});

describe("issuing", () => {
  test("hands back a token that parses, and stores a row", async () => {
    const token = await issueTrustedDevice("alice", UA, NOW);
    const parsed = parseToken(token);
    assert.ok(parsed, `unparseable token: ${token}`);

    const snap = await DEVICES().doc(parsed.id).get();
    assert.ok(snap.exists);
    assert.equal(snap.get("uid"), "alice");
    assert.equal(snap.get("expiresAt").toMillis(), NOW + TRUST_MS);
    assert.equal(snap.get("revokedAt"), null);
    assert.match(snap.get("label"), /iPhone/);
  });

  test("the secret is NOT in the document — only a salted hash is", async () => {
    // The claim the whole design rests on. A dump of this collection must
    // grant nobody anything.
    const token = await issueTrustedDevice("alice", UA, NOW);
    const { id, secret } = parseToken(token);

    const data = (await DEVICES().doc(id).get()).data();
    const serialised = JSON.stringify(data);
    assert.ok(!serialised.includes(secret), "the raw secret was written to the database");
    assert.ok(typeof data.hash === "string" && data.hash.length === 64, "expected a sha256 hex");
    assert.ok(typeof data.salt === "string" && data.salt.length > 0, "expected a salt");
    assert.notEqual(data.hash, data.salt);
  });

  test("two devices on one account get different secrets and different rows", async () => {
    const a = parseToken(await issueTrustedDevice("alice", UA, NOW));
    const b = parseToken(await issueTrustedDevice("alice", UA, NOW));
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.secret, b.secret);
    assert.equal((await DEVICES().get()).size, 2);
  });

  test("the same secret hashes differently for two devices, because of the salt", async () => {
    const a = parseToken(await issueTrustedDevice("alice", UA, NOW));
    const b = parseToken(await issueTrustedDevice("alice", UA, NOW));
    const [da, db] = await Promise.all([DEVICES().doc(a.id).get(), DEVICES().doc(b.id).get()]);
    assert.notEqual(da.get("salt"), db.get("salt"));
  });
});

describe("redeeming", () => {
  test("the right token on the right account works, and records the use", async () => {
    const token = await issueTrustedDevice("alice", UA, NOW);
    const result = await redeemTrustedDevice("alice", token, NOW + DAY);
    assert.equal(result.ok, true, result.reason);

    const { id } = parseToken(token);
    assert.equal((await DEVICES().doc(id).get()).get("lastUsedAt").toMillis(), NOW + DAY);
  });

  test("it keeps working for the whole thirty days, and stops after", async () => {
    const token = await issueTrustedDevice("alice", UA, NOW);
    assert.equal((await redeemTrustedDevice("alice", token, NOW + 29 * DAY)).ok, true);
    assert.equal((await redeemTrustedDevice("alice", token, NOW + 31 * DAY)).ok, false);
  });

  test("a tampered secret is refused", async () => {
    const token = await issueTrustedDevice("alice", UA, NOW);
    const { id, secret } = parseToken(token);
    // Flip one character, keeping the shape valid so it gets past parsing and
    // is actually compared.
    const flipped = (secret[0] === "A" ? "B" : "A") + secret.slice(1);
    const result = await redeemTrustedDevice("alice", `${id}.${flipped}`, NOW);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "bad-secret");
  });

  test("another account's token is refused, even with the correct secret", async () => {
    // Two crew on one handset is the realistic version of this.
    const token = await issueTrustedDevice("alice", UA, NOW);
    const result = await redeemTrustedDevice("bob", token, NOW);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "wrong-account");
  });

  test("an id that does not exist is refused without saying so differently", async () => {
    const result = await redeemTrustedDevice("alice", `${"z".repeat(22)}.${"y".repeat(43)}`, NOW);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unknown");
  });

  test("a malformed token never reaches the database", async () => {
    for (const bad of ["", "nope", null, undefined, 7, `${"a".repeat(22)}.short`]) {
      const result = await redeemTrustedDevice("alice", bad, NOW);
      assert.equal(result.ok, false);
      assert.equal(result.reason, "malformed", `for ${JSON.stringify(bad)}`);
    }
  });

  test("redeeming twice is fine — this is not a one-shot code", async () => {
    const token = await issueTrustedDevice("alice", UA, NOW);
    assert.equal((await redeemTrustedDevice("alice", token, NOW + DAY)).ok, true);
    assert.equal((await redeemTrustedDevice("alice", token, NOW + 2 * DAY)).ok, true);
  });
});

describe("revoking", () => {
  test("a revoked device stops working immediately, though it has not expired", async () => {
    const token = await issueTrustedDevice("alice", UA, NOW);
    assert.equal((await redeemTrustedDevice("alice", token, NOW)).ok, true);

    const revoked = await revokeAllTrustedDevices("alice", NOW + DAY);
    assert.equal(revoked, 1);

    const after = await redeemTrustedDevice("alice", token, NOW + 2 * DAY);
    assert.equal(after.ok, false);
    assert.equal(after.reason, "revoked");
  });

  test("it only touches the account that asked", async () => {
    const mine = await issueTrustedDevice("alice", UA, NOW);
    const theirs = await issueTrustedDevice("bob", UA, NOW);

    await revokeAllTrustedDevices("alice", NOW);

    assert.equal((await redeemTrustedDevice("alice", mine, NOW)).ok, false);
    assert.equal((await redeemTrustedDevice("bob", theirs, NOW)).ok, true, "bob was untouched");
  });

  test("revoking again reports nothing live, rather than failing", async () => {
    await issueTrustedDevice("alice", UA, NOW);
    assert.equal(await revokeAllTrustedDevices("alice", NOW), 1);
    assert.equal(await revokeAllTrustedDevices("alice", NOW), 0);
  });

  test("the row is kept, so losing a phone leaves a record", async () => {
    const token = await issueTrustedDevice("alice", UA, NOW);
    await revokeAllTrustedDevices("alice", NOW + DAY);
    const { id } = parseToken(token);
    const snap = await DEVICES().doc(id).get();
    assert.ok(snap.exists, "revoking must not delete the evidence");
    assert.equal(snap.get("revokedAt").toMillis(), NOW + DAY);
  });
});

describe("listing, for the Account screen", () => {
  test("shows live devices, newest expiry first", async () => {
    await issueTrustedDevice("alice", UA, NOW);
    await issueTrustedDevice("alice", "Mozilla/5.0 (Macintosh) Chrome/130", NOW + DAY);
    const rows = await listTrustedDevices("alice", NOW + 2 * DAY);
    assert.equal(rows.length, 2);
    assert.ok(rows[0].expiresAtMs > rows[1].expiresAtMs);
    assert.match(rows[1].label, /iPhone/);
  });

  test("hides expired and revoked ones", async () => {
    await issueTrustedDevice("alice", UA, NOW);
    assert.equal((await listTrustedDevices("alice", NOW + 31 * DAY)).length, 0, "expired hidden");

    await issueTrustedDevice("alice", UA, NOW);
    await revokeAllTrustedDevices("alice", NOW);
    assert.equal((await listTrustedDevices("alice", NOW)).length, 0, "revoked hidden");
  });

  test("never shows another account's devices", async () => {
    await issueTrustedDevice("bob", UA, NOW);
    assert.equal((await listTrustedDevices("alice", NOW)).length, 0);
  });
});
