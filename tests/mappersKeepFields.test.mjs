/**
 * A mapper must not silently drop a field another reader depends on.
 *
 * This bug class has now bitten three times, and never where it was written:
 *
 *   toCustomer skipped smsConsent and smsOptOut, so every client-side
 *   Customer read them as undefined. canSendTo therefore said "allowed" for a
 *   customer who had replied STOP, and TextConsentRow was dead from the day it
 *   shipped — the crew tapped "they said yes" and watched the row not change.
 *
 *   asPayments skipped provider and providerRef. That one reached money:
 *   providerRef is the only guard in lib/server/stripe.ts against a replayed
 *   checkout.session.completed, and recordPayment/removePayment rebuild the
 *   whole payments array from this read and write it back — so a crew member
 *   recording a check beside a card payment erased the session id and re-armed
 *   the double credit.
 *
 *   convertToInvoice omitted orgId, which firestore.rules rejects outright.
 *   Covered separately by tests/orgIdOnCreate.test.mjs.
 *
 * None of these is visible at the mapper. The field is simply absent, every
 * type still checks, and the damage lands in a caller somewhere else. So the
 * invariant is checked structurally: every field an interface declares must
 * appear in the mapper that builds it, or be named below with a reason.
 *
 * Source-read rather than executed, deliberately: the claim is about the SET
 * of fields a mapper handles, which no single test input can demonstrate. A
 * round-trip test proves the fields it happens to set and says nothing about
 * the one somebody forgets next year — which is precisely how all three got in.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

/** The field names an interface declares, at its top level. */
function interfaceFields(source, name) {
  const at = source.search(new RegExp(`export interface ${name}\\s*\\{`));
  assert.notEqual(at, -1, `interface ${name} not found`);
  const start = source.indexOf("{", at);
  let depth = 0;
  let end = start;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = stripComments(source.slice(start + 1, end));
  const fields = [];
  let depthInner = 0;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    // Skip comments, and anything nested inside a sub-object or union.
    const opens = (line.match(/[{[]/g) ?? []).length;
    const closes = (line.match(/[}\]]/g) ?? []).length;
    const atTop = depthInner === 0;
    depthInner += opens - closes;
    if (!atTop) continue;
    if (!line || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
    const m = line.match(/^([A-Za-z_$][\w$]*)\??\s*:/);
    if (m) fields.push(m[1]);
  }
  return fields;
}

/** Comments removed, so prose about a field cannot stand in for mapping it. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

/**
 * The body of a named function, by brace matching, with comments stripped.
 *
 * The stripping is load-bearing and was added after a mutation survived: the
 * comment inside asPayments explains why providerRef matters, so deleting the
 * line that actually maps it left the word sitting in the prose and the check
 * passed. A test that a comment can satisfy is not a test.
 */
function functionBody(source, name) {
  const at = source.search(new RegExp(`function ${name}\\s*\\(`));
  assert.notEqual(at, -1, `function ${name} not found`);
  const start = source.indexOf("{", source.indexOf(")", at));
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return stripComments(source.slice(start, i + 1));
    }
  }
  throw new Error(`could not brace-match ${name}`);
}

/**
 * Each mapper, the interface it builds, and the fields it may legitimately
 * leave out. Every exemption needs a reason somebody can check.
 */
const MAPPERS = [
  {
    label: "asPayments -> Payment",
    mapperFile: "lib/db/documents.ts",
    mapper: "asPayments",
    typeFile: "lib/documents.ts",
    type: "Payment",
    exempt: {},
  },
  {
    label: "toCustomer -> Customer",
    mapperFile: "lib/db/customers.ts",
    mapper: "toCustomer",
    typeFile: "lib/types.ts",
    type: "Customer",
    exempt: {
      id: "taken from the snapshot id, not the document body",
    },
  },
];

describe("every mapper carries every field of the type it builds", () => {
  for (const spec of MAPPERS) {
    test(spec.label, () => {
      const fields = interfaceFields(read(spec.typeFile), spec.type);
      assert.ok(fields.length > 4, `expected real fields on ${spec.type}, saw ${fields.length}`);

      const body = functionBody(read(spec.mapperFile), spec.mapper);
      const missing = fields.filter(
        (f) => !spec.exempt[f] && !new RegExp(`\\b${f}\\b`).test(body),
      );
      assert.deepEqual(
        missing,
        [],
        `${spec.mapper} never mentions ${missing.join(", ")} — a field the type ` +
          `declares and some caller therefore expects. Either map it, or add it ` +
          `to this spec's \`exempt\` with a reason. Three separate bugs have come ` +
          `from exactly this gap; see the header of this file.`,
      );
    });
  }

  test("the field extractor actually finds fields, rather than passing on an empty list", () => {
    // The failure mode that would make this whole file vacuous.
    const payment = interfaceFields(read("lib/documents.ts"), "Payment");
    assert.ok(payment.includes("providerRef"), `providerRef missing from ${payment.join(",")}`);
    assert.ok(payment.includes("amount"));
    const customer = interfaceFields(read("lib/types.ts"), "Customer");
    assert.ok(customer.includes("smsOptOut"), "the consent field that started this");
    assert.ok(customer.includes("orgId"));
  });

  test("the body extractor returns a real function body, with comments gone", () => {
    const body = functionBody(read("lib/db/documents.ts"), "asPayments");
    assert.match(body, /recordedByName/, "looks like the real mapper");
    assert.ok(body.length > 100 && body.length < 4000, `suspicious body length ${body.length}`);
    // The defect that let a mutation through: asPayments' comment names
    // providerRef and explains why it matters, so an uncommented read would
    // match the prose rather than the code.
    assert.doesNotMatch(body, /ONLY thing stopping/, "comments must be stripped");
    assert.doesNotMatch(body, /\/\//, "no line comments survive");
  });

  test("every exemption carries a real reason", () => {
    for (const spec of MAPPERS) {
      for (const [field, reason] of Object.entries(spec.exempt)) {
        assert.ok(
          typeof reason === "string" && reason.length > 25,
          `${spec.mapper}.${field} needs a real reason, not a placeholder`,
        );
      }
    }
  });
});

describe("the Stripe replay guard depends on what asPayments keeps", () => {
  test("the webhook refuses a session id already on the document", () => {
    const stripe = read("lib/server/stripe.ts");
    assert.match(
      stripe,
      /existing\.some\(\(entry\) => entry\?\.providerRef === payment\.sessionId\)/,
      "the only idempotency guard — if this changes, the test below changes with it",
    );
  });

  test("and the client rebuilds the whole array from the mapped read", () => {
    // This is why dropping providerRef was not cosmetic: these two write the
    // array back, so a field the mapper loses is a field the document loses.
    const docs = read("lib/db/documents.ts");
    assert.match(docs, /const payments = \[\.\.\.document\.payments, payment\]/);
    assert.match(docs, /const payments = document\.payments\.filter\(/);
    assert.match(functionBody(docs, "asPayments"), /providerRef/);
  });
});
