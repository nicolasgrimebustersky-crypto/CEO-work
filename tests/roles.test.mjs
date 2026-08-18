/**
 * Tests for who is allowed in.
 *
 * Opening sign up turns this file into the thing standing between a stranger
 * and every customer's home address. The cases that matter are the ones where
 * something is *missing or malformed* — because the tempting implementation
 * ("not pending, therefore crew") reads identically on the happy path and
 * fails open on all of them.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";

const {
  ADMIN_EMAIL,
  OWNER_UID,
  BOOTSTRAP_CREW,
  SIGNUP_ROLE,
  isAdmin,
  isBootstrapCrew,
  isCrew,
  roleFor,
} = await import("../lib/auth/roles.ts");

const NICK = BOOTSTRAP_CREW[0];
const STRANGER = "a-brand-new-account-uid";

describe("a brand new account", () => {
  test("registering does not let you in", () => {
    assert.equal(roleFor(STRANGER, SIGNUP_ROLE), "pending");
    assert.equal(isCrew(STRANGER, SIGNUP_ROLE), false);
  });

  test("sign up never writes crew", () => {
    // If this ever became "crew", the form would be the breach.
    assert.equal(SIGNUP_ROLE, "pending");
  });

  test("being approved lets you in", () => {
    assert.equal(isCrew(STRANGER, "crew"), true);
  });
});

describe("failing closed", () => {
  // Each of these is a way the stored role can be absent or wrong. All of them
  // must read as pending. The dangerous implementation passes every test above
  // and fails every test here.
  for (const [label, stored] of [
    ["no field at all", undefined],
    ["an explicit null", null],
    ["an empty string", ""],
    ["a typo", "Crew"],
    ["whitespace", " crew "],
    ["a truthy object", {}],
    ["a number", 1],
    ["a boolean", true],
    ["a value from some future version", "supervisor"],
  ]) {
    test(`${label} is pending, not crew`, () => {
      assert.equal(isCrew(STRANGER, stored), false, `${label} let someone in`);
    });
  }
});

describe("the bootstrap accounts", () => {
  test("are crew whatever is stored", () => {
    // The first account cannot wait for an approver who does not exist yet.
    assert.equal(isCrew(NICK, undefined), true);
    assert.equal(isCrew(NICK, "pending"), true);
    assert.equal(isCrew(NICK, null), true);
  });

  test("cannot be locked out by a damaged profile", () => {
    // A bad write to their own profile must not cost them their own business.
    assert.equal(roleFor(NICK, { corrupted: true }), "crew");
  });

  test("there are exactly two of them", () => {
    assert.equal(BOOTSTRAP_CREW.length, 2);
  });

  test("nobody else is one", () => {
    assert.equal(isBootstrapCrew(STRANGER), false);
    assert.equal(isBootstrapCrew(""), false);
    assert.equal(isBootstrapCrew(null), false);
    assert.equal(isBootstrapCrew(undefined), false);
  });

  test("a uid is matched whole, not by prefix", () => {
    // Substring matching would let `NICK + "x"` in.
    assert.equal(isBootstrapCrew(NICK.slice(0, -1)), false);
    assert.equal(isBootstrapCrew(`${NICK}x`), false);
  });
});

describe("agreeing with the rules file", () => {
  test("every bootstrap uid is in firestore.rules", () => {
    // These are two copies of one fact. If they drift, the app and the database
    // disagree about who is crew — and the database is the one that counts, so
    // the symptom is somebody who looks signed in and can read nothing.
    const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
    for (const uid of BOOTSTRAP_CREW) {
      assert.ok(rules.includes(uid), `${uid} is missing from firestore.rules`);
    }
  });

  test("the rules still refuse a self-set role", () => {
    // The whole escalation path in one line: sign up, then write your own
    // profile with role 'crew'. The rules must not allow `role` in a
    // self-update. This asserts the guard exists at all — the behaviour itself
    // is exercised against the emulator in tests/firestore.rules.test.mjs.
    const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
    assert.match(rules, /affectedKeys\(\)[\s\S]{0,80}'role'/);
  });
});


/* ------------------------------------------------------------ the admin */

describe("who can hand out access", () => {
  test("the admin email is the admin", () => {
    assert.equal(isAdmin(ADMIN_EMAIL), true);
  });

  test("case and stray whitespace do not matter", () => {
    // The same mailbox, and the same Firebase account.
    assert.equal(isAdmin(ADMIN_EMAIL.toUpperCase()), true);
    assert.equal(isAdmin(`  ${ADMIN_EMAIL}  `), true);
  });

  test("the other owner is not the admin", () => {
    // The point of the whole tier: Noah uses the entire app and grants
    // nothing. A bootstrap uid must not imply admin.
    assert.equal(isAdmin("noah.perkins@example.com"), false);
    for (const uid of BOOTSTRAP_CREW) {
      // Passing a uid where an email goes must never succeed.
      assert.equal(isAdmin(uid), false);
    }
  });

  test("nobody else is, however close the address looks", () => {
    const [local, domain] = ADMIN_EMAIL.split("@");
    for (const near of [
      `${local}@evil.com`,
      `evil${local}@${domain}`,
      `${local}@${domain}.evil.com`,
      `${local}+admin@${domain}`,
      `x${ADMIN_EMAIL}`,
      `${ADMIN_EMAIL}x`,
      local,
      domain,
      "",
      null,
      undefined,
      {},
    ]) {
      assert.equal(isAdmin(near), false, `${String(near)} was treated as admin`);
    }
  });

  test("admin is not something the database can grant", () => {
    // Deliberately not a stored role. If it were, anybody who could write the
    // field could mint an admin, and the one account that matters would be
    // only as safe as every write path in the app.
    assert.equal(isAdmin("someone@else.com"), false);
    assert.equal(roleFor("someone", "admin"), "pending", "'admin' is not a role");
  });

  test("the admin can always use the app", () => {
    // An admin locked out by their own profile could never reach the screen
    // that fixes it.
    assert.equal(isCrew("any-uid", "pending", ADMIN_EMAIL), true);
    assert.equal(isCrew("any-uid", undefined, ADMIN_EMAIL), true);
  });

  test("a non-admin's email does not grant app access on its own", () => {
    assert.equal(isCrew("stranger", "pending", "someone@else.com"), false);
  });
});

describe("the admin email agrees with the rules file", () => {
  test("firestore.rules checks the same address", () => {
    const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
    assert.ok(
      rules.includes(ADMIN_EMAIL),
      "firestore.rules does not mention the admin email — the app and the database disagree about who can grant access",
    );
    assert.match(rules, /request\.auth\.token\.email/);
  });
});

describe("the owner's account", () => {
  test("is one of the founding accounts", () => {
    // The sign-off notification is addressed to this uid. If it drifts out of
    // the crew list it addresses nobody, and the failure is silent — the owner
    // simply stops being told which jobs went unpaid.
    assert.equal(isBootstrapCrew(OWNER_UID), true);
  });

  test("is a real uid, not a placeholder", () => {
    assert.equal(typeof OWNER_UID, "string");
    assert.ok(OWNER_UID.length >= 20, OWNER_UID);
  });
});
