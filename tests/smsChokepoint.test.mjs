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
    const check = code.indexOf("numberSuppression(claim.phone, lead.orgId)");
    const send = code.indexOf("sendSmsToPhone(claim.phone");
    assert.ok(
      check > 0,
      `${ROUTE} must ask numberSuppression about the claimed number, scoped to its org — ` +
        "another business's replies and marks are not this one's to act on",
    );
    assert.ok(send > 0, `${ROUTE} must send through sendSmsToPhone`);
    assert.ok(check < send, "the check must come before the send, or it is decoration");

    const between = code.slice(check, send);
    // Every field the scan answers. Reading one and ignoring it is worse than
    // not reading it, because it looks covered — and a mutation run proved
    // that: dropping the two newest from this branch failed nothing until
    // they were added here.
    for (const field of ["optOut", "replied", "blocked", "refused", "movedOn"]) {
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

describe("one business cannot nurture another's leads", () => {
  /*
   * The cron runs on the Admin SDK, which bypasses firestore.rules entirely —
   * so the org scoping the rest of the app gets for free has to be written
   * into this route by hand. Without it, a consented lead belonging to another
   * business would receive Grime Busters marketing from Grime Busters' own
   * Twilio number, and one company's replies and do-not-knock marks would
   * suppress another company's sequence.
   *
   * Route-level, so source assertions; the shape of the key and the filter are
   * what they pin. The behaviour of the org comparison itself is asOrgId,
   * which is covered in its own tests.
   */
  const ROUTE = "app/api/cron/lead-nurture/route.ts";
  const code = readFileSync(join(ROOT, ROUTE), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  test("a record from another org is skipped before it becomes a candidate", () => {
    assert.match(
      code,
      /if \(asOrgId\(data\.orgId\) !== DEFAULT_ORG_ID\) continue;/,
      `${ROUTE} must drop foreign-org records while reading, not merely decline to text them`,
    );
    // Before the push, so a foreign lead never reaches the grouping — where it
    // would vote on suppression and progress for a number it does not share.
    const filter = code.indexOf("asOrgId(data.orgId) !== DEFAULT_ORG_ID");
    const push = code.indexOf("candidates.push(");
    assert.ok(filter > 0 && filter < push, "the filter must come before the candidate is built");
  });

  test("a legacy record with no orgId belongs to the default org", () => {
    // asOrgId treats a missing orgId as the default, matching firestore.rules,
    // which reads `data.get('orgId', 'grime-busters')`. Without that, every
    // record written before the field existed would be foreign and nothing
    // would ever be nurtured.
    assert.match(code, /asOrgId\(data\.orgId\)/, `${ROUTE} must normalise a missing orgId`);
    assert.doesNotMatch(
      code,
      /data\.orgId !== DEFAULT_ORG_ID/,
      "comparing the raw field would exclude every legacy record",
    );
  });

  test("the per-number claim is keyed by org as well as number", () => {
    // A phone number is not unique across businesses — a landlord, a property
    // manager or a spouse can be a customer of two of them.
    assert.match(
      code,
      /function numberKey\(orgId: string, key: string\)/,
      `${ROUTE} must key the shared claim by org and number`,
    );
    assert.match(
      code,
      /\.doc\(numberKey\(lead\.orgId, lead\.phoneKey\)\)/,
      "the claim document must be looked up by that key",
    );
    assert.doesNotMatch(
      code,
      /\.doc\(lead\.phoneKey\)/,
      "keying on the number alone lets one business's progress hold up another's",
    );
  });

  test("the suppression scan is asked about one org's records", () => {
    assert.match(
      code,
      /numberSuppression\(claim\.phone, lead\.orgId\)/,
      `${ROUTE} must scope the pre-send check by org`,
    );
  });

  test("the candidate carries its org, so nothing downstream has to guess", () => {
    assert.match(code, /orgId: asOrgId\(data\.orgId\),/, "Candidate must record the org it came from");
  });
});

describe("an opt-out belongs to the business it was told to", () => {
  /*
   * I argued the other way one round ago and was wrong, so the reasoning is
   * recorded here rather than in a commit message nobody will reread.
   *
   * Leaving the opt-out lookup unscoped was defended as erring toward not
   * texting somebody, which sounds like the safe direction and is not. The
   * cost is not a delayed message: a lead who gave *us* written consent is
   * silenced permanently because a different company's record for that number
   * carries a STOP — and silenced invisibly, reported as an ordinary skip in a
   * nightly run nobody reads twice. It is the consent-shadowing failure again
   * with a different mechanism, and that one was the worst finding in this PR
   * for the business.
   *
   * It is also simply not what an opt-out is. A person who told one company to
   * stop has not withdrawn the consent they gave another; STOP is a thing said
   * to a sender, not a global flag on a phone number.
   */
  const NOTES = readFileSync(join(ROOT, "lib/server/customerNotes.ts"), "utf8");
  const SMS = readFileSync(join(ROOT, "lib/server/customerSms.ts"), "utf8");
  const ROUTE = "app/api/cron/lead-nurture/route.ts";
  const code = readFileSync(join(ROOT, ROUTE), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  /**
   * One function's body, so a guard in a neighbouring function cannot stand in
   * for a missing one here.
   *
   * The first version of the test below searched the whole file, and
   * numberSuppression carries a byte-identical guard — so deleting the one in
   * optOutForPhone left every assertion passing. My own mutation run caught
   * it, which is the second time in two rounds that a source match has looked
   * like a test and not been one.
   */
  const bodyOf = (text, name) => {
    const start = text.indexOf(`export async function ${name}(`);
    assert.ok(start > 0, `${name} not found`);
    const next = text.indexOf("\nexport ", start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  };

  test("the org is required on the lookup, not defaulted", () => {
    // Required so typecheck names every caller. A default is how an unscoped
    // read survives a review: nothing fails, and the gap is invisible.
    const optOut = bodyOf(NOTES, "optOutForPhone");
    assert.match(
      optOut,
      /optOutForPhone\(\s*rawPhone: string,\s*orgId: string,\s*\)/,
      "optOutForPhone must take the org, and take it as a required argument",
    );
    assert.match(
      optOut,
      /if \(asOrgId\(data\.orgId\) !== orgId\) continue;/,
      "and must skip records outside it — checked inside this function's own body",
    );
  });

  test("the suppression scan is scoped in its own right", () => {
    // Pinned separately, for the same reason: each needs its own guard.
    const suppression = bodyOf(NOTES, "numberSuppression");
    assert.match(suppression, /if \(asOrgId\(data\.orgId\) !== orgId\) continue;/);
  });

  test("the scan answers every question the route asks it", () => {
    // If the scan stops setting one of these, the route's check silently
    // becomes a no-op rather than failing.
    const suppression = bodyOf(NOTES, "numberSuppression");
    assert.match(suppression, /found\.blocked = true/, "do not knock");
    assert.match(suppression, /found\.refused = true/, "an explicit no-texts");
    assert.match(suppression, /found\.movedOn = true/, "quoted, won or lost");
    assert.match(suppression, /found\.replied = true/, "an inbound text");
    assert.match(suppression, /found\.optOut = readOptOut/, "a recorded STOP");
  });

  test("the chokepoint passes it through rather than dropping it", () => {
    assert.match(
      SMS,
      /export async function sendSmsToPhone\(\s*phone: string,\s*body: string,\s*orgId: string,\s*\)/,
      "sendSmsToPhone must take the org",
    );
    assert.match(
      SMS,
      /optOutForPhone\(number, orgId\)/,
      "and hand it to the lookup — its own opt-out check was the second unscoped read",
    );
  });

  test("the cron scopes both of its lookups", () => {
    // Two separate reads on the nurture path, both of which were unscoped: the
    // pre-claim check and the one inside the send.
    assert.match(code, /optOutForPhone\(lead\.phone, lead\.orgId\)/, `${ROUTE} pre-claim check`);
    assert.match(code, /sendSmsToPhone\(claim\.phone, body, lead\.orgId\)/, `${ROUTE} send`);
    assert.doesNotMatch(
      code,
      /optOutForPhone\(lead\.phone\)/,
      "an unscoped lookup silences a consented lead permanently",
    );
  });

  test("every caller of either was made to decide", () => {
    // The Meta webhook is the other one. It writes its leads into the default
    // org, so that is the org whose opt-outs apply to them.
    const META = readFileSync(join(ROOT, "app/api/meta/leads/route.ts"), "utf8");
    assert.match(
      META,
      /sendSmsToPhone\(parsed\.phone, message, DEFAULT_ORG_ID\)/,
      "the Meta webhook must name the org it writes into",
    );
  });
});

describe("a hold that could not be released needs a person, and says so", () => {
  /*
   * The last branch in the per-lead catch, and it had gone stale rather than
   * being wrong when written. When it was added, the only thing a failed
   * release left behind was the claim's timestamp — so "this number waits five
   * days" was true. Then the pending marker arrived two rounds later, and a
   * failed release started leaving that behind too. No later run clears a
   * pending marker: the wait became indefinite and the message kept saying
   * five days.
   *
   * It also reported `failed` and returned early, which skipped both the
   * timeline note and — because the run's notification counts `held` outcomes
   * — the buzz that would have told anybody about it. The one outcome that
   * genuinely needs a person was the one nobody would hear about.
   */
  const ROUTE = "app/api/cron/lead-nurture/route.ts";
  const code = readFileSync(join(ROOT, ROUTE), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const perLeadCatch = code.slice(
    code.indexOf("} catch (error) {"),
    code.lastIndexOf("} catch (error) {"),
  );

  test("a failed release does not return early", () => {
    // The early return was what skipped the note and the notification.
    assert.doesNotMatch(
      perLeadCatch,
      /action: "failed",\s*reason: `\$\{reason\} \(and the claim could not be released/,
      "the stale branch must be gone",
    );
    assert.match(
      perLeadCatch,
      /let stuck = false/,
      `${ROUTE} must record a failed release and carry on to the note and the outcome`,
    );
  });

  test("it is reported as held, not failed", () => {
    // Only `held` reaches the run's notification.
    assert.match(
      perLeadCatch,
      /action: stuck \|\| sendState !== "none" \? "held" : "failed"/,
      "a hold left standing is held, however it came to be standing",
    );
  });

  test("it no longer promises a five-day wait it cannot keep", () => {
    assert.doesNotMatch(
      perLeadCatch,
      /waits \$\{MIN_GAP_DAYS\} days/,
      "the pending marker makes the wait indefinite, not five days",
    );
    assert.match(
      perLeadCatch,
      /stuck until somebody clears it/,
      "the reason must say a person is needed",
    );
  });

  test("it reaches the lead's timeline", () => {
    assert.match(
      perLeadCatch,
      /text: stuck/,
      "the note must distinguish a stuck hold from an ordinary failure",
    );
    // The sentence is split across concatenated lines in the source, so the
    // match is on its tail rather than the whole phrase.
    assert.match(perLeadCatch, /clearing by hand/, "and say what is needed");
    assert.match(perLeadCatch, /no later run will clear it/, "and why nothing else will do it");
  });

  test("the run's notification says a person is needed", () => {
    // It said "a text reached Twilio and was never recorded", which is one of
    // the two ways to be held and not the one a failed release produces.
    const notify = code.slice(code.indexOf("const held = outcomes.filter"));
    assert.match(
      notify,
      /held and needs? a person/,
      "the notification must name what the crew has to do, not only what happened",
    );
  });
});
