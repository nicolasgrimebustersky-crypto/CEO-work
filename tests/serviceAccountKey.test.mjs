/**
 * Reading the service-account credential out of an environment variable.
 *
 * Every case here is a real way a correct credential arrives mangled between a
 * downloaded JSON file and a hosting dashboard. They matter because the symptom
 * is identical in all of them — nobody can sign in to anything — and the
 * operator's only feedback is whatever this file decides to say.
 *
 * The rule the assertions enforce throughout: never print the value. It is a
 * private key with unrestricted access to the database.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { describeServiceAccountKey, parseServiceAccountKey, serviceAccountJson } =
  await import("../lib/serviceAccountKey.ts");

const GOOD = {
  type: "service_account",
  project_id: "grimeline-test",
  private_key_id: "abc123",
  private_key: "-----BEGIN PRIVATE KEY-----\\nMIIEvQ==\\n-----END PRIVATE KEY-----\\n",
  client_email: "firebase-adminsdk@grimeline-test.iam.gserviceaccount.com",
  client_id: "1",
};
const JSON_TEXT = JSON.stringify(GOOD);
const B64 = Buffer.from(JSON_TEXT).toString("base64");

describe("the forms that must work", () => {
  test("base64, one line — the documented form", () => {
    const parsed = parseServiceAccountKey(B64);
    assert.equal(parsed?.projectId, "grimeline-test");
    assert.equal(parsed?.clientEmail, GOOD.client_email);
  });

  test("raw JSON", () => {
    assert.equal(parseServiceAccountKey(JSON_TEXT)?.projectId, "grimeline-test");
  });

  test("the escaped newlines in the private key become real ones", () => {
    // Environment variables flatten newlines to the two characters \\ and n.
    // Left that way, the key is not a key and the SDK fails at signing time —
    // long after this code has declared everything fine.
    const key = parseServiceAccountKey(B64)?.privateKey ?? "";
    assert.ok(key.includes("\n"), "no real newlines");
    assert.ok(!key.includes("\\n"), "escaped newlines survived");
    assert.ok(key.startsWith("-----BEGIN PRIVATE KEY-----"));
  });
});

describe("handing back the document itself", () => {
  // The publish workflow writes this to disk for `firebase deploy`, which reads
  // token_uri and the rest. Rebuilding the file from the three fields
  // parseServiceAccountKey returns would drop them, and the failure would land
  // at authentication time rather than here.
  test("base64 in, the original JSON out", () => {
    assert.equal(serviceAccountJson(B64), JSON_TEXT);
  });

  test("raw JSON passes through unchanged", () => {
    assert.equal(serviceAccountJson(JSON_TEXT), JSON_TEXT);
  });

  test("every field survives, not just the three that are parsed", () => {
    const back = JSON.parse(serviceAccountJson(B64) ?? "{}");
    assert.equal(back.private_key_id, GOOD.private_key_id);
    assert.equal(back.client_id, GOOD.client_id);
    assert.equal(back.type, "service_account");
  });

  test("nothing usable in, null out", () => {
    assert.equal(serviceAccountJson(undefined), null);
    assert.equal(serviceAccountJson(""), null);
    assert.equal(serviceAccountJson("0fafcc110527a29a205fef2430b805093728de73"), null);
  });
});

describe("the forms a paste actually arrives in", () => {
  test("surrounded by double quotes, copied out of a .env file", () => {
    assert.equal(parseServiceAccountKey(`"${B64}"`)?.projectId, "grimeline-test");
  });

  test("surrounded by single quotes", () => {
    assert.equal(parseServiceAccountKey(`'${B64}'`)?.projectId, "grimeline-test");
  });

  test("quoted raw JSON", () => {
    assert.equal(parseServiceAccountKey(`"${JSON_TEXT}"`)?.projectId, "grimeline-test");
  });

  test("leading and trailing whitespace from a double-click selection", () => {
    assert.equal(parseServiceAccountKey(`  \n${B64}\n  `)?.projectId, "grimeline-test");
  });

  test("line-wrapped base64, from a textarea or a base64 run without -w0", () => {
    const wrapped = (B64.match(/.{1,64}/g) ?? []).join("\n");
    assert.equal(parseServiceAccountKey(wrapped)?.projectId, "grimeline-test");
  });
});

describe("the forms that must fail, and say why", () => {
  test("absent", () => {
    for (const nothing of ["", "   ", undefined]) {
      assert.equal(parseServiceAccountKey(nothing), null);
      assert.match(describeServiceAccountKey(nothing), /is not set on this deployment/);
    }
  });

  test("truncated — the most likely mistake with a 3,000-character paste", () => {
    const half = B64.slice(0, 120);
    assert.equal(parseServiceAccountKey(half), null);
    const said = describeServiceAccountKey(half);
    // Two things have to be in it: that the variable IS set — otherwise the
    // operator re-adds one that is already there — and a length they can
    // compare against the ~3,000 they pasted.
    assert.match(said, /is set \(120 characters\)/);
    // A half-copied base64 string still decodes to a JSON *prefix*, so this
    // lands on the "not valid JSON" branch rather than the undecodable one.
    // Either way it has to name incompleteness as the likely cause.
    assert.match(said, /cut short|truncated/i);
  });

  test("the length is reported, because that is the diagnosis", () => {
    // "Not configured" sends somebody to add a variable that is already there.
    // A number they can compare against 3,000 tells them what went wrong.
    assert.match(describeServiceAccountKey("x".repeat(87)), /87 characters/);
  });

  test("valid JSON, wrong document — someone pasted the wrong file", () => {
    const wrong = Buffer.from(JSON.stringify({ apiKey: "x" })).toString("base64");
    assert.equal(parseServiceAccountKey(wrong), null);
    const said = describeServiceAccountKey(wrong);
    assert.match(said, /project_id/);
    assert.match(said, /client_email/);
    assert.match(said, /private_key/);
  });

  test("one field blank rather than absent", () => {
    const blanked = Buffer.from(
      JSON.stringify({ ...GOOD, private_key: "" }),
    ).toString("base64");
    assert.equal(parseServiceAccountKey(blanked), null);
    assert.match(describeServiceAccountKey(blanked), /private_key/);
  });

  test("decodes to something that is not JSON at all", () => {
    const prose = Buffer.from("hello there, this is not a key").toString("base64");
    assert.equal(parseServiceAccountKey(prose), null);
    assert.match(describeServiceAccountKey(prose), /neither the service-account JSON/);
  });

  test("a good key reports no problem at all", () => {
    assert.equal(describeServiceAccountKey(B64), "");
    assert.equal(describeServiceAccountKey(JSON_TEXT), "");
  });
});

describe("what it is never allowed to say", () => {
  const secret = GOOD.private_key;

  test("no message quotes the key, whatever the failure", () => {
    // This is the whole reason the description is built rather than the value
    // logged. An error string ends up in browser consoles, screenshots and
    // support threads.
    const inputs = [B64, JSON_TEXT, B64.slice(0, 120), `"${B64}"`, "", "   ", undefined];
    for (const input of inputs) {
      const said = describeServiceAccountKey(input);
      assert.ok(!said.includes(secret), `leaked the key for input ${String(input).slice(0, 20)}`);
      assert.ok(!said.includes("BEGIN PRIVATE KEY"), "leaked a key header");
      assert.ok(!said.includes("MIIEvQ"), "leaked key material");
      if (input) assert.ok(!said.includes(String(input).slice(0, 40)), "echoed the value");
    }
  });

  test("it does not leak the client email or project either", () => {
    // Less severe, but still account detail that does not belong in an error
    // shown to whoever is holding the phone.
    const said = describeServiceAccountKey(B64.slice(0, 120));
    assert.ok(!said.includes(GOOD.client_email));
    assert.ok(!said.includes(GOOD.project_id));
  });
});
