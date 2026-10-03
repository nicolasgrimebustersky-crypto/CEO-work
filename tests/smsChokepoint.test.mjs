/**
 * Nothing texts a customer without asking whether it may.
 *
 * `canSendTo` shipped with the consent work and was wired into the two paths a
 * crew member triggers by hand. Three unattended ones were missed — the nightly
 * quote follow-up cron, the Meta lead webhook and the MCP send_sms tool — and
 * stayed missed, because a message Twilio silently drops looks exactly like a
 * message that was delivered.
 *
 * The fix was lib/server/customerSms.ts. This is the part that keeps it fixed:
 * a source scan, so the fourth path — written months from now by somebody who
 * has never read any of this — fails the build instead of quietly texting
 * people who said stop.
 *
 * The rule is the import, not the call. `lib/smsClient.ts` exports a `sendSms`
 * of its own that runs in the browser and POSTs to /api/sms/send, which is
 * guarded; matching on the name would flag it and two components along with it,
 * and a test that cries wolf gets an allowlist entry rather than a fix.
 *
 * Deliberately a file-level allowlist rather than a lint rule: it is greppable,
 * it explains itself, and adding to it is a visible decision in a diff.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** The module that talks to Twilio, however it is spelled in an import. */
const TWILIO_MODULE = /from\s+["'](?:@\/lib\/server\/twilio|\.\/twilio|\.\.\/server\/twilio)["']/;

/**
 * Files allowed to import the raw `sendSms`, and why.
 *
 * Three kinds of entry, and nothing else qualifies:
 *
 *   the chokepoint itself;
 *   a file that provably does not text a customer;
 *   a route that calls canSendTo inline for a reason the chokepoint cannot
 *   serve — both of the ones below refuse *before* spending something, and
 *   losing that ordering would be a real regression.
 *
 * Anything else goes through sendSmsToCustomer / sendSmsToCustomerId /
 * sendSmsToPhone. An entry here needs a reason somebody can check.
 */
const ALLOWED = new Map([
  ["lib/server/customerSms.ts", "the chokepoint — this is the file that checks"],
  [
    "app/api/sms/test/route.ts",
    "texts the signed-in crew member's own profile number, never a customer",
  ],
  [
    "app/api/sms/send/route.ts",
    "checks canSendTo itself so it can answer 409 before charging the rate limit",
  ],
  [
    "app/api/sms/blast/route.ts",
    "checks canSendTo per recipient so a refusal skips the 1.1s pacing delay — " +
      "200 refusals through the chokepoint would run past maxDuration",
  ],
]);

/** Source files worth scanning — the app, not its dependencies. */
function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** Does this file pull `sendSms` out of the Twilio module? */
function importsRawSend(text) {
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    const [names, statement] = [match[1], match[0]];
    if (!TWILIO_MODULE.test(statement)) continue;
    // `sendSms` as a whole imported name, not `sendSmsToCustomer` and not the
    // `SendResult` type alongside it.
    if (/(^|,)\s*sendSms\s*(,|$)/.test(names.replace(/\s*\n\s*/g, " "))) return true;
  }
  return false;
}

describe("every customer text goes through the consent check", () => {
  const files = ["app", "lib", "components"]
    .flatMap((d) => sourceFiles(join(ROOT, d)))
    .map((f) => ({ path: f.slice(ROOT.length), text: readFileSync(f, "utf8") }));

  test("the scan finds the app at all", () => {
    // A broken walk would make every assertion below pass vacuously.
    assert.ok(files.length > 50, `only found ${files.length} source files — scan is broken`);
  });

  test("the scan recognises an import when it sees one", () => {
    // Pins the matcher itself, so a refactor of the import style cannot turn
    // this whole file into a no-op that still reports green.
    assert.ok(importsRawSend('import { sendSms } from "@/lib/server/twilio";'));
    assert.ok(importsRawSend('import { isTwilioConfigured, sendSms } from "@/lib/server/twilio";'));
    assert.ok(importsRawSend('import { sendSms, type SendResult } from "./twilio";'));
    assert.ok(!importsRawSend('import { sendSmsToCustomer } from "@/lib/server/customerSms";'));
    assert.ok(!importsRawSend('import { sendSms } from "@/lib/smsClient";'));
    assert.ok(!importsRawSend('import { isTwilioConfigured } from "@/lib/server/twilio";'));
  });

  test("no unlisted file imports sendSms from the Twilio module", () => {
    const offenders = files
      .filter(({ text }) => importsRawSend(text))
      .map(({ path }) => path)
      .filter((path) => !ALLOWED.has(path))
      .sort();

    assert.deepEqual(
      offenders,
      [],
      "These reach Twilio directly and so skip canSendTo. Use sendSmsToCustomer, " +
        "sendSmsToCustomerId or sendSmsToPhone from lib/server/customerSms.ts — or, " +
        "if the file provably cannot be texting a customer, add it to ALLOWED here " +
        `with the reason:\n  ${offenders.join("\n  ")}`,
    );
  });

  test("the allowlist has no stale entries", () => {
    // An allowlist that outlives its reason is how the next gap gets waved
    // through: somebody adds a customer send to a file already listed.
    for (const [path] of ALLOWED) {
      const file = files.find((f) => f.path === path);
      assert.ok(file, `${path} is allowlisted but no longer exists — remove it`);
      assert.ok(
        importsRawSend(file.text),
        `${path} is allowlisted but no longer imports sendSms — remove it`,
      );
    }
  });

  test("the paths that were missed now go through the chokepoint", () => {
    // Named explicitly, because these are the ones that actually went wrong. A
    // generic rule alone would pass if somebody reverted one of them to a
    // helper that happened not to import sendSms by that name.
    for (const path of [
      "app/api/cron/quote-followups/route.ts",
      "app/api/meta/leads/route.ts",
      "lib/mcp/handlers.ts",
      "app/api/sms/send/route.ts",
      "app/api/sms/blast/route.ts",
    ]) {
      const file = files.find((f) => f.path === path);
      assert.ok(file, `${path} not found`);
      assert.match(
        file.text,
        /sendSmsTo(Customer|Phone)|canSendTo/,
        `${path} must check consent before it texts anybody`,
      );
    }
  });
});

describe("the lead nurture cron texts the number it actually checked", () => {
  /*
   * Two invariants that live in the shape of one function and cannot be
   * reached by a unit test — the cron runs on the Admin SDK against a real
   * Firestore, and this repository has no emulator harness for that.
   *
   * A source assertion is a weaker thing than running the code and is not
   * presented as more. What it does buy is that the next person to edit this
   * route gets a failing build rather than a silent regression, in a file that
   * explains why the ordering matters. Both of these were real bugs, not
   * hypotheticals.
   */
  const ROUTE = "app/api/cron/lead-nurture/route.ts";
  const text = readFileSync(join(ROOT, ROUTE), "utf8");
  // Comments stripped, because these assertions are about what the route
  // does. The prose explains which call was wrong and why, and naming it
  // there must not read as making it.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  test("it sends to the phone number the claim validated", () => {
    // sendSmsToCustomerId re-read the customer document, so a phone edit
    // between the claim and the send meant marketing going to a number whose
    // consent, opt-out state and nurture history had never been looked at.
    assert.match(
      code,
      /sendSmsToPhone\(\s*claim\.phone/,
      `${ROUTE} must send to claim.phone — the number the claim authorised`,
    );
    assert.doesNotMatch(
      code,
      /sendSmsToCustomerId/,
      `${ROUTE} must not re-read the customer to find a recipient: the number ` +
        "it was authorised to text is the one the claim returned",
    );
  });

  test("it asks whether the number replied, after the claim and before the send", () => {
    // A run works through its list for minutes. A reply landing on a different
    // record for the same handset in that window was invisible, so the
    // automation texted somebody who had just answered.
    const replyCheck = code.indexOf("hasReplyForPhone(claim.phone)");
    const send = code.indexOf("sendSmsToPhone(claim.phone");
    assert.ok(replyCheck > 0, `${ROUTE} must ask hasReplyForPhone about the claimed number`);
    assert.ok(send > 0, `${ROUTE} must send through sendSmsToPhone`);
    assert.ok(
      replyCheck < send,
      "the reply check must come before the send, or it is decoration",
    );
  });

  test("a refusal after the claim gives the claim back", () => {
    // The shared stamp holds every record for this number back. Left set
    // after a text that never went out, it delays the whole number by the
    // minimum gap for nothing.
    assert.match(
      code,
      /rollBackClaim\(docRef, claim\)/,
      `${ROUTE} must roll the claim back when it refuses after claiming`,
    );
    const rollbacks = code.match(/rollBackClaim\(docRef, claim\)/g) ?? [];
    assert.ok(
      rollbacks.length >= 2,
      "both post-claim refusals — the late reply and a failed send — must roll back, " +
        `found ${rollbacks.length}`,
    );
  });
});
