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

  test("it asks what the number says to stop for, after the claim and before the send", () => {
    // A run works through its list for minutes. A reply, a STOP or a
    // do-not-knock mark landing on a different record for the same handset in
    // that window was invisible, so the automation texted somebody who had
    // just answered or had just asked not to be contacted.
    //
    // All three, because checking only replies here was the gap that let the
    // third one through: the grouping caught a do-not-knock sibling at the top
    // of the run and nothing caught one that arrived during it.
    const check = code.indexOf("numberSuppression(claim.phone)");
    const send = code.indexOf("sendSmsToPhone(claim.phone");
    assert.ok(check > 0, `${ROUTE} must ask numberSuppression about the claimed number`);
    assert.ok(send > 0, `${ROUTE} must send through sendSmsToPhone`);
    assert.ok(check < send, "the check must come before the send, or it is decoration");

    const between = code.slice(check, send);
    for (const field of ["optOut", "replied", "blocked"]) {
      assert.match(
        between,
        new RegExp(`stop\\.${field}`),
        `${ROUTE} must act on ${field} before sending — reading it and ignoring it is worse ` +
          "than not reading it, because it looks covered",
      );
    }
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

describe("a claim never outlives the attempt that made it", () => {
  /*
   * The claim writes two timestamps and they hold back every record for a
   * phone number. If something throws between the claim and the send — and
   * hasReplyForPhone scans the whole customer collection, so it can — the
   * claim used to stand with no text sent, delaying that person by the minimum
   * gap over a failure that achieved nothing, silently.
   *
   * Route-level, so a source assertion again, and the same caveat applies: it
   * is weaker than running the code and is here so that reverting the fix
   * fails the build.
   */
  const ROUTE = "app/api/cron/lead-nurture/route.ts";
  const code = readFileSync(join(ROOT, ROUTE), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  test("the claim and the send state outlive the try, so the catch can see them", () => {
    assert.match(
      code,
      /let claim[^\n]*=\s*null/,
      `${ROUTE} must hold the claim outside the try, or the catch cannot release it`,
    );
    assert.match(
      code,
      /let sendState: SendState = "none"/,
      `${ROUTE} must track what is known about the send — three cases, not a ` +
        "boolean, because a send whose answer never came back is neither sent nor not-sent",
    );
    assert.doesNotMatch(
      code,
      /let texted\s*=/,
      "a boolean cannot hold three cases; that gap released the hold on a " +
        "message that may have been delivered",
    );
  });

  // The per-lead catch, not the route's outer one. Both match the same
  // opening, and the outer one comes later in the file.
  const perLeadCatch = code.slice(
    code.indexOf("} catch (error) {"),
    code.lastIndexOf("} catch (error) {"),
  );

  test("the catch releases a claim that never became a text", () => {
    const catchBlock = perLeadCatch;
    assert.match(
      catchBlock,
      /claim\?\.claimed\s*&&\s*mayRelease\(sendState, released\)/,
      "the catch must release a claim only when nothing was sent and that is known — " +
        "after a successful send it would resend, and after an uncertain one it " +
        "would resend something that may already have arrived",
    );
    assert.match(catchBlock, /rollBackClaim/, "the catch must actually roll the claim back");
  });

  test("a failure reaches the lead's timeline", () => {
    // A lead that silently failed to be nurtured looks exactly like one that
    // was never due.
    assert.match(perLeadCatch, /appendNote/, "the catch must record the failure on the timeline");
  });
});

describe("a claim is released once, and only by its owner", () => {
  /*
   * The failed-send path releases its claim and then writes a note about the
   * failure. When that note write threw, the catch released the same claim a
   * second time — and between the two releases the number was free for an
   * overlapping run to claim, which the blind second release then erased.
   *
   * The ownership half of the fix is tested properly in
   * tests/leadNurture.test.mjs via claimStillOwns. This is the route half: the
   * flag, and the fact that the release is transactional rather than two
   * independent writes.
   */
  const ROUTE = "app/api/cron/lead-nurture/route.ts";
  const code = readFileSync(join(ROOT, ROUTE), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  test("the catch will not release a claim already given back", () => {
    assert.match(code, /let released\s*=\s*false/, `${ROUTE} must track whether it released`);
    assert.match(
      code,
      /mayRelease\(sendState, released\)/,
      "the catch must skip a claim the failed-send path already released",
    );
  });

  test("every release sets the flag", () => {
    // Call sites only — the function's own declaration is not a release.
    const releases = code.match(/await rollBackClaim\(/g) ?? [];
    const flags = code.match(/released\s*=\s*true/g) ?? [];
    assert.ok(releases.length >= 2, `expected every release site, found ${releases.length}`);
    assert.equal(
      flags.length,
      releases.length,
      "each release must mark itself, or a later one will repeat it",
    );
  });

  test("the release is one transaction, checked against the claim's own stamp", () => {
    const fn = code.slice(code.indexOf("async function rollBackClaim"));
    const body = fn.slice(0, fn.indexOf("\ninterface "));
    assert.match(body, /runTransaction/, "a two-write release is not atomic");
    assert.match(
      body,
      /claimStillOwns/,
      "a release must check it still owns what it is undoing, or it can erase a live claim",
    );
    assert.match(code, /stamp: Timestamp/, "the claim must carry the stamp it wrote");
  });
});

describe("a lost answer from Twilio is not a refusal", () => {
  /*
   * `sendSms` used to collapse every failure into `{ ok: false, error }`, so a
   * number Twilio rejected and a request whose answer never came back were
   * indistinguishable downstream. The cron released its claim on both — and in
   * the second case the text may well have been delivered, so releasing the
   * hold meant sending the same message again five days later.
   *
   * The classification itself is tested by running it, in
   * tests/smsDelivery.test.mjs. It used to be pinned here by matching
   * lib/server/twilio.ts with a regex, and that was worth less than it looked:
   * the rule it pinned was wrong — it called an HTTP 503 a rejection — and the
   * regex passed anyway. What is left here is the part that is genuinely about
   * this route: that it asks for the classification rather than re-deriving
   * one.
   */
  const ROUTE = "app/api/cron/lead-nurture/route.ts";
  const code = readFileSync(join(ROOT, ROUTE), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  test("the cron releases its claim only on a confirmed non-send", () => {
    assert.match(
      code,
      /sendState = sendStateFrom\(result\)/,
      `${ROUTE} must classify the result rather than inspect ok alone`,
    );
    const failure = code.slice(code.indexOf("if (!result.ok) {"));
    const guard = failure.indexOf("mayRelease(sendState, released)");
    const release = failure.indexOf("rollBackClaim");
    assert.ok(guard > 0 && guard < release, "the release must sit behind that rule");
  });

  test("an uncertain send is held, not filed as failed", () => {
    // Reported as held so somebody checks whether it arrived. Filing it as a
    // plain failure would read as "nothing was sent", which is the thing
    // nobody actually knows.
    const failure = code.slice(code.indexOf("if (!result.ok) {"));
    assert.match(
      failure,
      /action: certain \? "failed" : "held"/,
      `${ROUTE} must distinguish a failure from an unknown in what it reports`,
    );
  });

  test("the run sends one notification, whatever mix of outcomes it had", () => {
    // A run that nudged three leads and held one used to send two.
    const calls = code.match(/await notifyCrew\(/g) ?? [];
    assert.equal(
      calls.length,
      1,
      `${ROUTE} must notify once per run, not once per kind of outcome — found ${calls.length}`,
    );
  });
});

describe("a claim is released once, and only by its owner", () => {
  /*
   * The failed-send path releases its claim and then writes a note about the
   * failure. When that note write threw, the catch released the same claim a
   * second time — and between the two releases the number was free for an
   * overlapping run to claim, which the blind second release then erased.
   *
   * The ownership half of the fix is tested properly in
   * tests/leadNurture.test.mjs via claimStillOwns. This is the route half: the
   * flag, and the fact that the release is transactional rather than two
   * independent writes.
   */
  const ROUTE = "app/api/cron/lead-nurture/route.ts";
  const code = readFileSync(join(ROOT, ROUTE), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  test("the catch will not release a claim already given back", () => {
    assert.match(code, /let released\s*=\s*false/, `${ROUTE} must track whether it released`);
    assert.match(
      code,
      /mayRelease\(sendState, released\)/,
      "the catch must skip a claim the failed-send path already released",
    );
  });

  test("every release sets the flag", () => {
    // Call sites only — the function's own declaration is not a release.
    const releases = code.match(/await rollBackClaim\(/g) ?? [];
    const flags = code.match(/released\s*=\s*true/g) ?? [];
    assert.ok(releases.length >= 2, `expected every release site, found ${releases.length}`);
    assert.equal(
      flags.length,
      releases.length,
      "each release must mark itself, or a later one will repeat it",
    );
  });

  test("the release is one transaction, checked against the claim's own stamp", () => {
    const fn = code.slice(code.indexOf("async function rollBackClaim"));
    const body = fn.slice(0, fn.indexOf("\ninterface "));
    assert.match(body, /runTransaction/, "a two-write release is not atomic");
    assert.match(
      body,
      /claimStillOwns/,
      "a release must check it still owns what it is undoing, or it can erase a live claim",
    );
    assert.match(code, /stamp: Timestamp/, "the claim must carry the stamp it wrote");
  });
});
