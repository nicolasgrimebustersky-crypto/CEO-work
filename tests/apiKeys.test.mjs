/**
 * API keys — the only thing standing between the internet and the customer book.
 *
 * Worth being blunt about why these tests are careful: the MCP route runs on the
 * Firebase Admin SDK, which bypasses every Firestore security rule. There is no
 * second layer behind these checks. If `hasScope` returns true when it should
 * not, an agent texts a customer with a key that was never meant to.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  KEY_PREFIX,
  MAX_LABEL,
  SCOPES,
  SCOPE_HINT,
  SCOPE_LABEL,
  agentAuthor,
  bearerFrom,
  cleanScopes,
  hasScope,
  isAgentUid,
  isRevoked,
  isScope,
  keyHint,
  labelProblem,
  looksLikeKey,
  normalizeKey,
  scopeProblem,
} = await import("../lib/apiKeys.ts");

const REAL = `${KEY_PREFIX}${"a".repeat(43)}`;
const key = (patch = {}) => ({ id: "k1", label: "Ops Agent", scopes: ["read"], ...patch });

/* ------------------------------------------------------------ recognising one */

describe("what counts as one of our keys", () => {
  test("a real one does", () => {
    assert.equal(looksLikeKey(REAL), true);
  });

  test("the prefix is required", () => {
    // It is what makes a leaked key greppable in a log and recognisable when
    // somebody pastes it into the wrong window.
    assert.equal(looksLikeKey("a".repeat(43)), false);
    assert.equal(looksLikeKey(`sk_${"a".repeat(43)}`), false);
  });

  test("something far too short is not a key", () => {
    assert.equal(looksLikeKey(`${KEY_PREFIX}abc`), false);
  });

  test("nothing at all is not a key", () => {
    for (const nothing of ["", "   ", null, undefined]) {
      assert.equal(looksLikeKey(nothing), false, String(nothing));
    }
  });

  test("characters outside base64url are refused", () => {
    assert.equal(looksLikeKey(`${KEY_PREFIX}${"a".repeat(40)}!!!`), false);
    assert.equal(looksLikeKey(`${KEY_PREFIX}${"a".repeat(40)} mid dle`), false);
  });

  test("whitespace around a pasted key is tolerated, not refused", () => {
    // A key copied out of a dashboard routinely arrives with a trailing
    // newline. The operator pasted the right thing; refusing it would repeat
    // the service-account-key mistake.
    assert.equal(looksLikeKey(`  ${REAL}\n`), true);
  });

  test("every entry point normalises the same way", () => {
    // The subtle bug this pins: if the shape check trims and the hash lookup
    // does not, a key with a trailing newline passes one and fails the other,
    // and the error blames a key that is perfectly valid.
    const messy = `  ${REAL}\n`;
    assert.equal(normalizeKey(messy), REAL);
    assert.equal(bearerFrom(`Bearer ${messy}`), REAL);
    assert.equal(keyHint(messy), keyHint(REAL));
  });

  test("the hint identifies a key without recovering it", () => {
    const hint = keyHint(REAL);
    assert.ok(hint.startsWith(KEY_PREFIX));
    assert.ok(hint.length < REAL.length / 2, "a hint that long is most of the key");
    assert.equal(keyHint("not-a-key"), "");
  });
});

describe("pulling it out of a header", () => {
  test("a normal bearer header", () => {
    assert.equal(bearerFrom(`Bearer ${REAL}`), REAL);
  });

  test("case does not matter — clients disagree about it", () => {
    assert.equal(bearerFrom(`bearer ${REAL}`), REAL);
    assert.equal(bearerFrom(`BEARER ${REAL}`), REAL);
  });

  test("anything else is nothing", () => {
    for (const bad of ["", "   ", null, undefined, REAL, `Basic ${REAL}`, "Bearer", "Bearer   "]) {
      assert.equal(bearerFrom(bad), null, String(bad));
    }
  });
});

/* ---------------------------------------------------------------- the scopes */

describe("scopes", () => {
  test("every scope has a label and a hint that says what leaking it costs", () => {
    for (const scope of SCOPES) {
      assert.equal(typeof SCOPE_LABEL[scope], "string");
      assert.ok(SCOPE_HINT[scope].length > 20, `${scope} hint is too thin to be useful`);
    }
  });

  test("an invented scope is not a scope", () => {
    assert.equal(isScope("read"), true);
    assert.equal(isScope("admin"), false);
    assert.equal(isScope("delete_everything"), false);
    assert.equal(isScope(undefined), false);
  });

  test("stored scopes are cleaned, never trusted", () => {
    // A key document is data. If something ever writes junk into it, the junk
    // must not become a permission.
    assert.deepEqual(cleanScopes(["read", "nonsense", "send"]), ["read", "send"]);
    assert.deepEqual(cleanScopes(["read", "read"]), ["read"], "no duplicates");
    assert.deepEqual(cleanScopes("read"), [], "a bare string is not a list");
    assert.deepEqual(cleanScopes(null), []);
    assert.deepEqual(cleanScopes([1, {}, null]), []);
  });

  test("scopes come back in a fixed order regardless of how they were stored", () => {
    assert.deepEqual(cleanScopes(["send", "read"]), ["read", "send"]);
  });
});

describe("what a key may do", () => {
  test("it has the scope it was given, and no others", () => {
    const readOnly = key({ scopes: ["read"] });
    assert.equal(hasScope(readOnly, "read"), true);
    assert.equal(hasScope(readOnly, "write"), false);
    assert.equal(hasScope(readOnly, "send"), false);
  });

  test("scopes do not imply each other", () => {
    // "send" is not a superset of "read". A key issued only to text somebody
    // should not thereby be able to read the whole customer book.
    const sendOnly = key({ scopes: ["send"] });
    assert.equal(hasScope(sendOnly, "read"), false);
  });

  test("a revoked key can do nothing, whatever its scopes say", () => {
    const dead = key({ scopes: ["read", "write", "send"], revokedAt: { toMillis: () => 1 } });
    assert.equal(isRevoked(dead), true);
    for (const scope of SCOPES) {
      assert.match(scopeProblem(dead, scope), /revoked/i, scope);
    }
  });

  test("a live key with the scope has no problem", () => {
    assert.equal(scopeProblem(key({ scopes: ["read"] }), "read"), null);
  });

  test("a refusal names the missing scope, so it can be fixed", () => {
    // An agent told "forbidden" retries the same call. One told which scope is
    // missing reports something its operator can act on.
    const problem = scopeProblem(key({ scopes: ["read"] }), "send");
    assert.match(problem, /"send"/);
    assert.match(problem, /Account screen/);
  });

  test("an empty scope list grants nothing", () => {
    for (const scope of SCOPES) {
      assert.equal(hasScope(key({ scopes: [] }), scope), false);
    }
  });
});

/* --------------------------------------------------------------- the label */

describe("naming a key", () => {
  test("a name is required", () => {
    // A key nobody can identify is a key nobody dares revoke six months later.
    assert.match(labelProblem(""), /name/i);
    assert.match(labelProblem("   "), /name/i);
  });

  test("a sensible name is fine", () => {
    assert.equal(labelProblem("Ops Agent"), null);
  });

  test("an essay is not a name", () => {
    assert.match(labelProblem("x".repeat(MAX_LABEL + 1)), new RegExp(String(MAX_LABEL)));
  });
});

/* --------------------------------------------------------- who did the thing */

describe("attribution", () => {
  test("an agent's writes are stamped as the agent, not as a person", () => {
    // Without this, an agent's mistake is indistinguishable from a human's
    // three weeks later.
    const author = agentAuthor(key({ id: "abc123", label: "Ops Agent" }));
    assert.equal(author.uid, "agent:abc123");
    assert.equal(author.displayName, "Ops Agent");
  });

  test("an unnamed key still says it was an agent", () => {
    assert.equal(agentAuthor(key({ label: "  " })).displayName, "Ops Agent");
  });

  test("agent authorship is recognisable after the fact", () => {
    assert.equal(isAgentUid("agent:abc123"), true);
    assert.equal(isAgentUid("Bzo7rclax4SdT7PaAua1monNxXG3"), false);
    assert.equal(isAgentUid(null), false);
  });
});
