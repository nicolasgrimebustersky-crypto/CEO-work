/**
 * Every client-SDK create in an org-scoped collection must carry orgId.
 *
 * firestore.rules gates those creates on createsInMyOrg(request.resource.data),
 * which asks that orgId is a non-empty string equal to the caller's org. A
 * MISSING field fails `is string` before any comparison, so a payload that
 * forgets it is denied outright — the feature does not misbehave, it does not
 * work at all.
 *
 * This has now happened twice in one file. scheduleAsJob shipped without it
 * and every "Schedule the job" was denied until #63. convertToInvoice shipped
 * without it too, so every "Convert to invoice" was denied — and because that
 * one is a writeBatch, the estimate's own convertedToId patch went down with
 * it and nothing applied at all.
 *
 * Both were invisible to the rules suite, because a rules test writes its own
 * fixture and hard-codes orgId: it proves the RULE works, never that the APP
 * sends the field. So the invariant is checked here against the real payloads.
 *
 * Two properties carry this file, and both are mutation-tested at the bottom:
 *   1. EVERY create site in a required file is checked — not one per
 *      identifier name. createDocument and convertToInvoice both call their
 *      payload `payload`, and an earlier version of this test resolved only
 *      the first, so it passed while the second was broken.
 *   2. A NEW create site must be classified before it can pass.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync, readdirSync } from "node:fs";

const DB_DIR = new URL("../lib/db/", import.meta.url);
/**
 * Comments blanked, line numbers preserved.
 *
 * The scanner below looks for `setDoc(` and friends in the raw text, which
 * means prose about a create is indistinguishable from a create. That is not
 * hypothetical: a comment in lib/db/automations.ts explaining why a write uses
 * `setDoc(..., { merge: true })` was reported as an unclassified create site
 * with no orgId, and the only honest fixes were to reword the comment or to
 * stop reading comments. Rewording teaches the wrong lesson — that the test
 * owns the prose — and the next person would add an exemption for a phantom
 * instead.
 *
 * `mappersKeepFields.test.mjs` learned the mirror of this: a comment must not
 * be able to SATISFY a check. A comment must not be able to FAIL one either.
 *
 * String state is tracked so a `//` inside a URL literal, or a `/*` inside a
 * regex-looking string, does not swallow the rest of the file. Newlines
 * survive, so every reported line number still points at the real line.
 */
function stripCommentsKeepingLines(source) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (quote) {
      if (ch === "\\") {
        out += ch + (next ?? "");
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      out += "  ";
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

const read = (f) => stripCommentsKeepingLines(readFileSync(new URL(f, DB_DIR), "utf8"));

/** Collections whose create rule demands createsInMyOrg, read from the rules. */
function orgScopedCollections() {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const out = new Set();
  const re = /match\s+\/([A-Za-z]+)\/\{[^}]*\}\s*\{/g;
  let m;
  while ((m = re.exec(rules))) {
    const after = rules.slice(m.index, m.index + 4000);
    const create = after.match(/allow create:[\s\S]*?;/);
    if (create && create[0].includes("createsInMyOrg")) out.add(m[1]);
  }
  return out;
}

/** The object literal bound to `ident` by the NEAREST declaration before `at`. */
function literalFor(source, ident, at) {
  const needle = `const ${ident} = {`;
  // Nearest preceding declaration, not the first in the file. Getting this
  // wrong is what made the earlier version of this test vacuous.
  const decl = source.lastIndexOf(needle, at);
  if (decl === -1) return null;
  const start = source.indexOf("{", decl);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Create call sites, with the payload each one writes.
 *
 * Paren-aware, because the first argument is itself a call:
 * addDoc(collection(getDb(), COLLECTION), payload). A regex that stops at the
 * first comma captures COLLECTION and checks the wrong string entirely.
 */
function createSites(source) {
  const sites = [];
  for (const opener of ["addDoc(", "batch.set(", "setDoc("]) {
    let from = 0;
    for (;;) {
      const at = source.indexOf(opener, from);
      if (at === -1) break;
      from = at + opener.length;

      let i = from;
      let depth = 1;
      let argStart = i;
      const args = [];
      for (; i < source.length && depth > 0; i += 1) {
        const ch = source[i];
        if (ch === "(" || ch === "{" || ch === "[") depth += 1;
        else if (ch === ")" || ch === "}" || ch === "]") {
          depth -= 1;
          if (depth === 0) args.push(source.slice(argStart, i));
        } else if (ch === "," && depth === 1) {
          args.push(source.slice(argStart, i));
          argStart = i + 1;
        }
      }
      const arg = (args[1] ?? "").trim();
      if (!arg) continue;

      const line = source.slice(0, at).split("\n").length;
      if (arg.startsWith("{")) {
        sites.push({ kind: "inline", at, line, literal: arg });
        continue;
      }
      const ident = arg.match(/^([A-Za-z_$][\w$]*)/);
      if (!ident) continue;
      sites.push({
        kind: "ident",
        ident: ident[1],
        at,
        line,
        literal: literalFor(source, ident[1], at),
      });
    }
  }
  return sites.sort((a, b) => a.at - b.at);
}

/** Top-level `orgId:` — not one nested inside a sub-object. */
function hasTopLevelOrgId(literal) {
  let depth = 0;
  for (let i = 0; i < literal.length; i += 1) {
    const ch = literal[i];
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
    else if (depth === 1 && literal.startsWith("orgId:", i)) return true;
  }
  return false;
}

const FILES = readdirSync(DB_DIR)
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => read(f).includes('from "firebase/firestore"'));

/** Files where EVERY create site writes an org-scoped document. */
const MUST_HAVE_ORG_ID = [
  "customers.ts",
  "documents.ts",
  "jobs.ts",
  "quotes.ts",
  "knockRoutes.ts",
  "territories.ts",
  "services.ts",
  "automations.ts",
];

/** Whole files exempt, with the reason. */
const EXEMPT = {
  "apiKeys.ts": "apiKeys is server-only and absent from firestore.rules entirely",
  "notifications.ts": "rowFor() builds a payload per recipient; its own suite covers it",
  "pushTokens.ts": "a push token is keyed by uid and carries no org of its own",
  "users.ts": "a user profile is what myOrgId() READS, so it cannot assert against it",
  "conversations.ts":
    "the conversation itself is checked below; messages and reads are gated on " +
    "inConversation(), not createsInMyOrg — the parent carries the org",
};

describe("the rules still demand an org on create", () => {
  test("createsInMyOrg gates the collections this file assumes it does", () => {
    // Without this the invariant below is vacuous: it would pass by checking
    // nothing if the rules stopped requiring the field.
    const scoped = orgScopedCollections();
    assert.ok(scoped.size >= 8, `expected many org-scoped collections, saw ${scoped.size}`);
    for (const c of ["customers", "documents", "jobs", "quotes", "services"]) {
      assert.ok(scoped.has(c), `${c} must be org-scoped on create`);
    }
  });
});

describe("every org-scoped create payload carries orgId", () => {
  for (const file of MUST_HAVE_ORG_ID) {
    test(file, () => {
      const source = read(file);
      const sites = createSites(source);
      assert.ok(sites.length > 0, `no create site found in ${file}`);
      for (const site of sites) {
        const where = `${file}:${site.line} (${site.kind === "ident" ? site.ident : "inline"})`;
        assert.ok(site.literal, `could not resolve the payload at ${where}`);
        assert.ok(
          hasTopLevelOrgId(site.literal),
          `${where} has no top-level orgId — firestore.rules denies this create ` +
            `outright, because a missing field fails \`orgId is string\` before ` +
            `any comparison`,
        );
      }
    });
  }
});

describe("the checks cannot pass vacuously", () => {
  test("no create site escapes classification", () => {
    // Both past bugs were NEW create sites nobody thought to check. A new one
    // now fails here until somebody puts it in a list, on purpose.
    const unclassified = [];
    for (const file of FILES) {
      if (EXEMPT[file] || MUST_HAVE_ORG_ID.includes(file)) continue;
      for (const site of createSites(read(file))) {
        unclassified.push(`${file}:${site.line}`);
      }
    }
    assert.deepEqual(
      unclassified,
      [],
      `unclassified create site(s) — add the file to MUST_HAVE_ORG_ID (and set ` +
        `orgId on the payload) or to EXEMPT with a reason:\n  ${unclassified.join("\n  ")}`,
    );
  });

  test("both of documents.ts's create payloads are found, not just the first", () => {
    // The exact defect that made an earlier version of this test useless:
    // createDocument and convertToInvoice both name their payload `payload`,
    // and resolving by first-match-in-file checked one twice.
    const sites = createSites(read("documents.ts")).filter((s) => s.kind === "ident");
    assert.ok(sites.length >= 3, `expected 3 create sites, saw ${sites.length}`);
    const literals = new Set(sites.map((s) => s.literal));
    assert.equal(
      literals.size,
      sites.length,
      "two create sites resolved to the SAME literal — the resolver is binding " +
        "to the first declaration in the file rather than the nearest one, so " +
        "one of the payloads is never actually checked",
    );
  });

  test("the parser resolves real payloads, not the collection constant", () => {
    const sites = createSites(read("documents.ts")).filter((s) => s.kind === "ident");
    assert.ok(
      !sites.some((s) => s.ident === "COLLECTION"),
      "resolving to the collection constant means the arguments were mis-split",
    );
    assert.ok(
      sites.every((s) => s.literal && s.literal.includes("createdAt")),
      "each resolved literal must look like a real document payload",
    );
  });

  test("every exemption carries a real reason", () => {
    for (const [file, reason] of Object.entries(EXEMPT)) {
      assert.ok(
        typeof reason === "string" && reason.length > 30,
        `${file}'s exemption needs a real reason, not a placeholder`,
      );
    }
  });
});
