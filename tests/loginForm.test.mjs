/**
 * The login screen's own checks, before Firebase is asked.
 *
 * The one that matters most is the last: the two password boxes agreeing.
 * Firebase never sees the confirmation field, so if this file gets it wrong
 * nothing else will notice — the account is simply created with whichever
 * value the code happened to send.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { MIN_PASSWORD, looksLikeEmail, signInProblem, registerProblem, resetProblem } =
  await import("../lib/loginForm.ts");

const GOOD = {
  name: "Nick",
  email: "nick@example.com",
  password: "hunter22",
  confirm: "hunter22",
};

describe("what counts as an email", () => {
  test("a plain address does", () => {
    assert.equal(looksLikeEmail("nick@example.com"), true);
    assert.equal(looksLikeEmail("  nick@example.com\n"), true);
  });

  test("a name typed in the email box does not", () => {
    for (const bad of ["", "   ", "Nick", "nick@", "@example.com", "a@b", "two words@x.com"]) {
      assert.equal(looksLikeEmail(bad), false, `accepted ${JSON.stringify(bad)}`);
    }
  });
});

describe("signing in", () => {
  test("nothing wrong with a full form", () => {
    assert.equal(signInProblem({ email: GOOD.email, password: GOOD.password }), null);
  });

  test("the empty case is named, not just refused", () => {
    assert.match(signInProblem({ email: "", password: "" }) ?? "", /email/i);
    assert.match(signInProblem({ email: GOOD.email, password: "" }) ?? "", /password/i);
  });

  test("a password is not trimmed or length-checked on sign-in", () => {
    // Whatever they registered with is what opens the account. Refusing a
    // short one here would lock out anybody whose password predates the rule.
    assert.equal(signInProblem({ email: GOOD.email, password: "ab" }), null);
  });
});

describe("registering", () => {
  test("nothing wrong with a full form", () => {
    assert.equal(registerProblem(GOOD), null);
  });

  test("problems are reported top to bottom, one at a time", () => {
    assert.match(registerProblem({ ...GOOD, name: " " }) ?? "", /name/i);
    assert.match(registerProblem({ ...GOOD, email: "nick" }) ?? "", /email/i);
    assert.match(registerProblem({ ...GOOD, password: "", confirm: "" }) ?? "", /password/i);
  });

  test("the minimum length is stated as a number", () => {
    const short = "a".repeat(MIN_PASSWORD - 1);
    assert.match(
      registerProblem({ ...GOOD, password: short, confirm: short }) ?? "",
      new RegExp(String(MIN_PASSWORD)),
    );
    const enough = "a".repeat(MIN_PASSWORD);
    assert.equal(registerProblem({ ...GOOD, password: enough, confirm: enough }), null);
  });

  test("the two passwords have to agree exactly", () => {
    assert.match(registerProblem({ ...GOOD, confirm: "hunter23" }) ?? "", /match/i);
    // A trailing space is a different password, and would be tomorrow too.
    assert.match(registerProblem({ ...GOOD, confirm: "hunter22 " }) ?? "", /match/i);
  });
});

describe("asking for a reset link", () => {
  test("with an address typed", () => {
    assert.equal(resetProblem(GOOD.email), null);
  });

  test("with the box still empty, the answer says what to do", () => {
    assert.match(resetProblem("") ?? "", /above first/);
  });

  test("with a name in the box, it is not sent anywhere", () => {
    assert.match(resetProblem("Nick") ?? "", /isn't valid/);
  });
});
