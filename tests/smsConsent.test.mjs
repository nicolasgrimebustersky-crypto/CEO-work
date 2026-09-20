/**
 * Who may be texted.
 *
 * The cases worth writing down are the ones where a wrong answer is expensive
 * in a way nobody notices: a customer who said stop being texted anyway, a
 * customer confirming an appointment being cut off because their reply
 * contained the word "stop", and a YES meant as "book the job" being read as
 * "subscribe me" and quietly clearing an opt-out.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  classifyReply,
  canSendTo,
  needsConsentAsked,
  grantConsent,
  declineConsent,
  recordOptOut,
  consentLabel,
  CONSENT_METHODS,
} = await import("../lib/smsConsent.ts");

const AT = new Date("2026-09-19T15:00:00Z");
const CREW = { uid: "u1", name: "Noah" };

describe("reading what a reply is asking for", () => {
  test("the CTIA opt-out keywords", () => {
    for (const word of ["STOP", "stop", "StopAll", "UNSUBSCRIBE", "cancel", "END", "quit"]) {
      assert.equal(classifyReply(word), "opt_out", word);
    }
  });

  test("the plain-English ways people actually say it", () => {
    for (const phrase of ["stop texting me", "remove me", "no more texts", "opt out"]) {
      assert.equal(classifyReply(phrase), "opt_out", phrase);
    }
  });

  test("punctuation and spacing do not hide the keyword", () => {
    for (const word of ["STOP.", "  stop  ", "Stop!", "stop?", "“STOP”", "stop  all"]) {
      assert.equal(classifyReply(word), "opt_out", JSON.stringify(word));
    }
  });

  test("a sentence that merely contains the word is NOT an opt-out", () => {
    // The expensive false positive: a customer confirming a visit, cut off.
    for (const sentence of [
      "Stop by around 3 and we'll be home",
      "Can you stop at the side gate",
      "The rain should stop by Tuesday",
      "Please don't stop at the neighbour's",
    ]) {
      assert.equal(classifyReply(sentence), "message", sentence);
    }
  });

  test("START and UNSTOP put somebody back on", () => {
    assert.equal(classifyReply("START"), "opt_in");
    assert.equal(classifyReply("unstop"), "opt_in");
  });

  test("YES is NOT an opt-in — it is how a customer books a job", () => {
    // The estimate text says "Reply YES to book it". Reading that as a
    // subscription instruction would clear an opt-out the customer meant,
    // which is why the campaign registers START and UNSTOP only.
    assert.equal(classifyReply("YES"), "message");
    assert.equal(classifyReply("yes"), "message");
    assert.equal(classifyReply("Yes please"), "message");
  });

  test("HELP is recognised", () => {
    assert.equal(classifyReply("HELP"), "help");
    assert.equal(classifyReply("info"), "help");
  });

  test("an ordinary reply is an ordinary reply", () => {
    for (const text of ["Sounds good", "Can you come Friday?", "", "   ", null, undefined]) {
      assert.equal(classifyReply(text), "message", JSON.stringify(text));
    }
  });
});

describe("whether we may text somebody", () => {
  const phone = "5025550100";

  test("a customer with a number and nothing recorded may be texted", () => {
    // Every record entered before consent was tracked looks like this. Refusing
    // them would mean a business that cannot contact its own customers.
    const verdict = canSendTo({ phone });
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.reason, "");
  });

  test("no phone number, no text", () => {
    assert.equal(canSendTo({ phone: "" }).allowed, false);
    assert.equal(canSendTo({}).allowed, false);
  });

  test("an opt-out stops it", () => {
    const verdict = canSendTo({ phone, smsOptOut: recordOptOut("STOP", AT) });
    assert.equal(verdict.allowed, false);
    assert.match(verdict.reason, /replied STOP/i);
    assert.match(verdict.reason, /START/, "tells the crew how it gets undone");
  });

  test("an opt-out outranks a consent recorded afterwards", () => {
    // Somebody ticking the consent box for a customer who already said stop
    // has been overridden by a colleague, not persuaded by the customer.
    const verdict = canSendTo({
      phone,
      smsOptOut: recordOptOut("STOP", new Date("2026-09-19T15:00:00Z")),
      smsConsent: grantConsent("verbal", CREW, new Date("2026-09-19T15:05:00Z")),
    });
    assert.equal(verdict.allowed, false);
  });

  test("a recorded refusal stops it", () => {
    const verdict = canSendTo({ phone, smsConsent: declineConsent("verbal", CREW, AT) });
    assert.equal(verdict.allowed, false);
    assert.match(verdict.reason, /declined/i);
  });

  test("a recorded consent allows it", () => {
    assert.equal(canSendTo({ phone, smsConsent: grantConsent("verbal", CREW, AT) }).allowed, true);
  });
});

describe("prompting the crew to ask", () => {
  test("nothing recorded is worth asking about", () => {
    assert.equal(needsConsentAsked({ phone: "5025550100" }), true);
  });

  test("a recorded answer either way is settled", () => {
    assert.equal(needsConsentAsked({ smsConsent: grantConsent("verbal", CREW, AT) }), false);
    assert.equal(needsConsentAsked({ smsConsent: declineConsent("verbal", CREW, AT) }), false);
  });

  test("somebody who opted out is not prompted", () => {
    assert.equal(needsConsentAsked({ smsOptOut: recordOptOut("STOP", AT) }), false);
  });
});

describe("what gets written down", () => {
  test("consent carries who asked and when", () => {
    // The verbal script filed with the campaign says consent, the date and the
    // crew member are recorded. A field storing only `true` cannot back that.
    const consent = grantConsent("verbal", CREW, AT);
    assert.equal(consent.granted, true);
    assert.equal(consent.method, "verbal");
    assert.equal(consent.byName, "Noah");
    assert.equal(consent.byUid, "u1");
    assert.equal(consent.at, "2026-09-19T15:00:00.000Z");
  });

  test("every method is a real one", () => {
    for (const method of CONSENT_METHODS) {
      assert.equal(grantConsent(method, CREW, AT).method, method);
    }
    assert.deepEqual([...CONSENT_METHODS], ["verbal", "web_form", "written"]);
  });

  test("an opt-out keeps what they actually sent", () => {
    // So a wrong classification can be found later rather than argued about.
    assert.equal(recordOptOut("STOP ALL", AT).keyword, "STOP ALL");
    assert.equal(recordOptOut("  quit  ", AT).at, "2026-09-19T15:00:00.000Z");
  });

  test("a hostile keyword cannot bloat the record", () => {
    assert.ok(recordOptOut("x".repeat(500), AT).keyword.length <= 40);
  });
});

describe("the line the crew reads before texting", () => {
  test("says plainly when somebody opted out", () => {
    assert.match(consentLabel({ smsOptOut: recordOptOut("STOP", AT) }), /do not text/i);
  });

  test("names how and when consent was given, and who asked", () => {
    const label = consentLabel({ smsConsent: grantConsent("verbal", CREW, AT) });
    assert.match(label, /verbally/);
    assert.match(label, /2026-09-19/);
    assert.match(label, /Noah/);
  });

  test("the website box reads differently from a doorstep conversation", () => {
    const web = consentLabel({ smsConsent: grantConsent("web_form", { uid: "customer", name: "" }, AT) });
    assert.match(web, /website form/);
  });

  test("an untracked record says so rather than implying consent", () => {
    assert.match(consentLabel({ phone: "5025550100" }), /No text consent recorded/i);
  });

  test("a refusal reads as a refusal", () => {
    assert.match(consentLabel({ smsConsent: declineConsent("verbal", CREW, AT) }), /Declined/);
  });
});
