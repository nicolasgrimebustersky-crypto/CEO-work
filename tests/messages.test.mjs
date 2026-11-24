/**
 * Every outbound text says how to stop receiving them.
 *
 * This is a registration promise, not a preference. The A2P 10DLC campaign
 * filed with Twilio states that our messages carry "Reply STOP to opt out",
 * and the SMS terms published at grimebusterskyllc.com/terms tell customers
 * the same. A template that ships without it makes both untrue, and the way
 * that happens is somebody adding a twelfth message months from now and not
 * knowing this rule exists.
 *
 * So the check below is deliberately not a list of eleven assertions: it walks
 * every exported template in the module, which means a new one is covered the
 * day it is written rather than the day somebody remembers to add a case.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const messages = await import("../lib/messages.ts");

/** The exact line the campaign registration and the SMS terms both promise. */
const OPT_OUT = "Reply STOP to opt out.";

/**
 * Plausible arguments for every template, by name.
 *
 * Kept beside the walk rather than inside it so that adding a template with a
 * new shape fails loudly here — an uncalled template is an unchecked one, and
 * silently skipping it would defeat the whole point.
 */
const CALLS = {
  jobConfirmationText: ["Pressure washing", new Date("2026-05-04T14:00:00Z")],
  jobRescheduledText: ["Pressure washing", new Date("2026-05-06T09:30:00Z")],
  recurringBookedText: ["Pressure washing", "2weeks", 8, new Date("2026-05-04T14:00:00Z")],
  quoteText: ["Pressure washing", "$450.00"],
  rainDayText: [
    [
      { service: "Mowing", start: new Date("2026-05-07T13:00:00Z") },
      { service: "Mowing", nextVisit: new Date("2026-05-12T13:00:00Z") },
    ],
  ],
  greetingFor: ["Marta"],
  enRouteText: ["Marta"],
  jobStartedText: ["Noah"],
  jobFinishedText: ["Noah"],
  visitFinishedText: ["Noah", "estimate"],
  reviewRequestText: ["Marta", "https://g.page/r/ExampleToken/review"],
  leadNurtureText: ["nudge", "Marta", 450],
  automationSmsText: [
    "Hi {first_name}, {business} here — want the gutters cleared before the leaves drop?",
    { first_name: "Marta", business: "Grime Busters" },
  ],
};

/** greetingFor is a fragment used to build other texts, not a message itself. */
const NOT_A_MESSAGE = new Set(["greetingFor"]);

describe("the opt-out line", () => {
  test("every template carries it", () => {
    const templates = Object.entries(messages).filter(
      ([, value]) => typeof value === "function",
    );
    assert.ok(templates.length >= 7, "expected to find the templates at all");

    for (const [name, fn] of templates) {
      if (NOT_A_MESSAGE.has(name)) continue;
      if (name === "documentText") continue; // covered below, all three branches

      const args = CALLS[name];
      assert.ok(args, `${name} has no arguments here — add them, don't skip it`);
      assert.match(fn(...args), new RegExp(OPT_OUT.replace(/\./g, "\\.")), name);
    }
  });

  test("an automation's own wording gets the line appended exactly once", () => {
    // The owner writes these bodies in the builder, so both halves of this
    // matter: a body without the line must get one, and a body where he typed
    // it himself must not end up saying it twice.
    const added = messages.automationSmsText("Gutters before the leaves drop?", {});
    assert.ok(added.includes(OPT_OUT), added);
    assert.equal(added.split("Reply STOP").length - 1, 1, added);

    const already = messages.automationSmsText(
      "Gutters before the leaves drop? Reply STOP to opt out.",
      {},
    );
    assert.equal(already.split("Reply STOP").length - 1, 1, already);
  });

  test("an empty body produces nothing, rather than a bare opt-out line", () => {
    // Otherwise a cleared message field sends the word "Reply STOP to opt out."
    // on its own to everybody the automation matched.
    assert.equal(messages.automationSmsText("   ", {}), "");
  });

  test("all three document branches carry it", () => {
    // Estimate, part-paid invoice and full invoice are three separate returns,
    // and a walk that calls documentText once would only ever see one of them.
    const estimate = messages.documentText("estimate", "Pressure washing", 450, 450);
    const partPaid = messages.documentText("invoice", "Pressure washing", 450, 200);
    const invoice = messages.documentText("invoice", "Pressure washing", 450, 0);

    for (const [label, text] of [
      ["estimate", estimate],
      ["part-paid invoice", partPaid],
      ["invoice", invoice],
    ]) {
      assert.ok(text.includes(OPT_OUT), `${label}: ${text}`);
    }
  });

  test("the link still comes last, after the opt-out", () => {
    // The reason documentText builds the link tail separately: a URL followed
    // by punctuation gets swallowed into the href by some messages apps and the
    // customer taps through to a 404. Putting the opt-out before the link keeps
    // the link the final thing in the message, which is what keeps it tappable.
    const link = "https://grimebusterskyllc.com/q/abc123";
    const text = messages.documentText("estimate", "Pressure washing", 450, 450, link);

    assert.ok(text.endsWith(link), `link must be last, got: ${text}`);
    assert.ok(text.indexOf(OPT_OUT) < text.indexOf(link), "opt-out must precede the link");
  });

  test("it is not doubled up", () => {
    // Appending in two places would read as nagging and waste a segment.
    const text = messages.jobConfirmationText("Pressure washing", new Date());
    assert.equal(text.split(OPT_OUT).length - 1, 1);
  });
});

describe("message length", () => {
  test("the scheduling texts still fit one SMS segment", () => {
    // 160 GSM-7 characters is one segment; going over doubles the cost of every
    // send. This is the template the opt-out line came closest to pushing over,
    // so it is the one worth pinning.
    const text = messages.jobConfirmationText("Pressure washing", new Date("2026-05-04T14:00:00Z"));
    assert.ok(text.length <= 160, `${text.length} chars: ${text}`);
  });

  test("so does the recurring summary, at the largest booking that can be made", () => {
    // 52 is MAX_REPEATS, and "every 2 weeks" is the longest cadence label, so
    // this is the worst case the form can produce for the parts this template
    // controls. The service phrase is the caller's and can be longer; that is
    // true of jobConfirmationText above too, and is why both are pinned on the
    // same representative service rather than on a worst-case string.
    const text = messages.recurringBookedText(
      "Pressure washing",
      "2weeks",
      52,
      new Date("2026-05-04T14:00:00Z"),
    );
    assert.ok(text.length <= 160, `${text.length} chars: ${text}`);
  });

  test("the recurring summary stays in GSM-7, so one segment really is 160", () => {
    // A single character outside GSM-7 — an em dash is the easy mistake —
    // switches the whole message to UCS-2 and cuts the segment to 70, which
    // makes the length check above meaningless rather than wrong.
    const text = messages.recurringBookedText(
      "Pressure washing",
      "week",
      12,
      new Date("2026-05-04T14:00:00Z"),
    );
    assert.doesNotMatch(text, /[^\x20-\x7E]/, `non-GSM-7 character in: ${text}`);
  });
});

describe("a recurring booking is one text, not one per visit", () => {
  test("it says the cadence and the count instead of listing visits", () => {
    // The whole reason this template exists: "Make recurring" can book 52
    // visits in one tap, and the obvious implementation texts 52 times.
    const text = messages.recurringBookedText(
      "Pressure washing",
      "2weeks",
      8,
      new Date("2026-05-04T14:00:00Z"),
    );
    assert.match(text, /every 2 weeks/);
    assert.match(text, /8 visits/);
    // The first visit is named, so the customer knows when to expect somebody.
    assert.match(text, /Monday May 4/);
  });
});

describe("who the message says it is from", () => {
  test("every message names the business", () => {
    // A text from an unknown number that does not say who it is reads as a scam
    // and gets reported as one, which is its own kind of carrier problem.
    for (const [name, args] of Object.entries(CALLS)) {
      if (NOT_A_MESSAGE.has(name)) continue;
      const text = messages[name](...args);
      assert.match(text, /Grime Busters/, name);
    }
    assert.match(messages.documentText("estimate", "Landscaping", 100, 100), /Grime Busters/);
  });
});

/**
 * No message body is written anywhere but this module.
 *
 * The walk above only sees templates that live in lib/messages.ts, so it
 * cannot see a body somebody builds inline at a call site — and two had been.
 * `schedule_job` in lib/mcp/handlers.ts named the service by its raw enum with
 * the underscores swapped out, and QuoteSheet sent a price. Neither carried
 * the opt-out line, so for as long as they existed the campaign registration
 * and the published SMS terms were both untrue, and nothing failed.
 *
 * The rule is the business name: every outbound template opens with it, so a
 * hand-rolled body is one that contains "Grime Busters:" outside this module.
 * That is greppable, it is what a person writing the next one would type, and
 * it fails in a diff rather than in a carrier audit.
 *
 * A file-level allowlist rather than a lint rule, matching
 * tests/smsChokepoint.test.mjs, which exists for the same reason one layer
 * down: that one checks that something asked whether it may text, this one
 * checks what it said.
 */
describe("no message body is written outside lib/messages.ts", () => {
  const ROOT = new URL("..", import.meta.url).pathname;
  const PREFIX = "Grime Busters:";

  /** The module that owns the wording, and the trees worth walking. */
  const HOME = join("lib", "messages.ts");
  const TREES = ["lib", "components", "app"];

  /**
   * Nothing is allowlisted, including lib/messages.ts itself — and that is not
   * an oversight. Its templates open with `${BUSINESS_NAME}:`, so the literal
   * never appears there either. Writing it out is exactly and only what a
   * hand-rolled body does, which makes this scan a question with one right
   * answer everywhere: no file should contain it.
   */
  const ALLOWED = new Set();

  function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  test("the prefix appears only there", () => {
    const offenders = [];
    for (const tree of TREES) {
      for (const file of walk(join(ROOT, tree))) {
        const relative = file.slice(ROOT.length);
        if (ALLOWED.has(relative)) continue;
        if (readFileSync(file, "utf8").includes(PREFIX)) offenders.push(relative);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these write a customer message body outside lib/messages.ts, so the ` +
        `opt-out check cannot see it: ${offenders.join(", ")}`,
    );
  });

  test("and the templates really do compose that prefix, so the scan means something", () => {
    // Guards the guard. The scan above is only meaningful while the module
    // builds the prefix from a constant: if somebody inlined the business name
    // into the templates here, every one of them would become an "offender"
    // and the obvious fix would be to allowlist this file — at which point the
    // scan stops catching the thing it exists to catch.
    const home = readFileSync(join(ROOT, HOME), "utf8");
    assert.match(home, /const BUSINESS_NAME = "Grime Busters";/);
    assert.match(home, /\$\{BUSINESS_NAME\}:/);
    assert.ok(!home.includes(PREFIX), "lib/messages.ts should compose the prefix, not spell it");
  });
});
