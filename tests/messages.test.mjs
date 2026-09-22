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
  quoteFollowUpText: ["Landscaping", 450, 1],
  greetingFor: ["Marta"],
  enRouteText: ["Marta"],
  jobStartedText: ["Noah"],
  jobFinishedText: ["Noah"],
  reviewRequestText: ["Marta", "https://g.page/r/ExampleToken/review"],
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
