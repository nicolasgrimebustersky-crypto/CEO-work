/**
 * The public website forms, filed as clients.
 *
 * The only write into the CRM that anybody on the internet can make, so the
 * tests lean on what a stranger can put in each field rather than on the
 * happy path.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { validateWebsiteLead, websiteLeadNote, splitName, cleanEmail, cleanPhone, MAX_MESSAGE_CHARS } =
  await import("../lib/websiteLead.ts");

const booking = (over = {}) => ({
  form: "booking",
  name: "Jay Rennirts",
  phone: "(502) 541-4631",
  address: "12 Oak St, Crestwood KY",
  service: "House wash",
  message: "Back patio too.",
  preferredDate: "10/24/2026",
  smsConsent: true,
  honeypot: "",
  ...over,
});

describe("what gets filed", () => {
  test("a complete booking comes back cleaned", () => {
    const out = validateWebsiteLead(booking());
    assert.equal(out.ok, true);
    assert.equal(out.value.firstName, "Jay");
    assert.equal(out.value.lastName, "Rennirts");
    assert.equal(out.value.form, "booking");
    assert.equal(out.value.smsConsent, true);
  });

  test("an email alone is enough to reach them", () => {
    const out = validateWebsiteLead(booking({ phone: "", email: "Jay@Example.com " }));
    assert.equal(out.ok, true);
    assert.equal(out.value.email, "jay@example.com");
  });

  test("no name is refused", () => {
    const out = validateWebsiteLead(booking({ name: "   " }));
    assert.equal(out.ok, false);
    assert.equal(out.bot, false);
  });

  test("no way to reach them is refused", () => {
    const out = validateWebsiteLead(booking({ phone: "12", email: "not-an-email" }));
    assert.equal(out.ok, false);
    assert.match(out.problem, /phone number or an email/);
  });

  test("an unknown form is refused", () => {
    for (const form of ["contact", "", undefined, 3]) {
      assert.equal(validateWebsiteLead(booking({ form })).ok, false);
    }
  });
});

describe("bots", () => {
  test("a filled honeypot is a bot, reported as such and never filed", () => {
    const out = validateWebsiteLead(booking({ honeypot: "http://spam.example" }));
    assert.equal(out.ok, false);
    assert.equal(out.bot, true);
  });

  test("whitespace in the honeypot is not a bot", () => {
    assert.equal(validateWebsiteLead(booking({ honeypot: "  " })).ok, true);
  });
});

describe("hostile text", () => {
  test("fields are capped", () => {
    const out = validateWebsiteLead(booking({ address: "x".repeat(5000), message: "y".repeat(50_000) }));
    assert.equal(out.ok, true);
    assert.ok(out.value.address.length <= 200);
    assert.equal(out.value.message.length, MAX_MESSAGE_CHARS);
  });

  test("non-strings become empty, not crashes", () => {
    const out = validateWebsiteLead(booking({ address: { $gt: "" }, service: ["a"], message: 7 }));
    assert.equal(out.ok, true);
    assert.equal(out.value.address, "");
    assert.equal(out.value.service, "");
    assert.equal(out.value.message, "");
  });

  test("consent is only ever a real boolean", () => {
    assert.equal(validateWebsiteLead(booking({ smsConsent: "true" })).value.smsConsent, null);
    assert.equal(validateWebsiteLead(booking({ smsConsent: false })).value.smsConsent, false);
    assert.equal(validateWebsiteLead(booking({ smsConsent: undefined })).value.smsConsent, null);
  });

  test("line breaks in the message survive, runs of blank lines do not", () => {
    const out = validateWebsiteLead(booking({ message: "Line one\n\n\n\nLine two" }));
    assert.equal(out.value.message, "Line one\n\nLine two");
  });
});

describe("helpers", () => {
  test("names split on the last space", () => {
    assert.deepEqual(splitName("Mary Ann Smith"), { firstName: "Mary Ann", lastName: "Smith" });
    assert.deepEqual(splitName("Cher"), { firstName: "Cher", lastName: "" });
    assert.deepEqual(splitName("  "), { firstName: "", lastName: "" });
  });

  test("emails and phones", () => {
    assert.equal(cleanEmail("a@b.co"), "a@b.co");
    assert.equal(cleanEmail("a@b"), "");
    assert.equal(cleanPhone("502-541-4631"), "502-541-4631");
    assert.equal(cleanPhone("555-0100"), "");
  });
});

describe("the timeline note", () => {
  test("keeps the request, says which form, and records the consent answer", () => {
    const note = websiteLeadNote(validateWebsiteLead(booking()).value);
    assert.match(note, /^Booking request from the website\./);
    assert.match(note, /Service: House wash/);
    assert.match(note, /Preferred date: 10\/24\/2026/);
    assert.match(note, /Texts: agreed on the form\./);
    assert.match(note, /Back patio too\.$/);
  });

  test("a declined consent is spelled out", () => {
    const note = websiteLeadNote(validateWebsiteLead(booking({ smsConsent: false })).value);
    assert.match(note, /declined on the form — call or email only/);
  });

  test("the quote tool's estimate is kept", () => {
    const note = websiteLeadNote(
      validateWebsiteLead({ form: "quote", name: "Ann Lee", email: "ann@x.com", estimate: "$180–$240" }).value,
    );
    assert.match(note, /^Instant quote request from the website\./);
    assert.match(note, /Website estimate: \$180–\$240/);
    assert.doesNotMatch(note, /Texts:/);
  });
});
