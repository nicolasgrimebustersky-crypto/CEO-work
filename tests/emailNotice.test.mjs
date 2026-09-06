/**
 * The approval email.
 *
 * Two things are worth testing and one of them is not cosmetic. The customer's
 * typed name and their message come from a page with no login on it and land
 * inside an HTML document, so the escaping is a boundary, not formatting. The
 * other is the configuration read: this feature is opt-in, and "opt-in" is only
 * a design if a half-set variable is refused rather than half-honoured.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  DEFAULT_FROM,
  readRecipients,
  readEmailConfig,
  emailSetupHint,
  escapeHtml,
  spellDate,
  acceptedEmail,
} = await import("../lib/emailNotice.ts");

const NOTICE = {
  customerName: "Marta Oakley",
  number: "EST-1042",
  service: "Pressure washing",
  total: "$420.00",
  requestedDate: "2026-09-12",
  signedName: "Marta Oakley",
  message: "",
  documentUrl: "https://ceo-work.vercel.app/invoices/detail?id=abc",
};

describe("who the notice goes to", () => {
  test("one address", () => {
    assert.deepEqual(readRecipients("nicolas@example.com"), ["nicolas@example.com"]);
  });

  test("several, with the whitespace a paste leaves behind", () => {
    assert.deepEqual(readRecipients(" a@example.com , b@example.com "), [
      "a@example.com",
      "b@example.com",
    ]);
  });

  test("the same address twice is one recipient, whatever the case", () => {
    // Two copies of the same mail reads as a bug in the app, and it is one.
    assert.deepEqual(readRecipients("A@example.com,a@example.com"), ["A@example.com"]);
  });

  test("things that are not addresses are dropped, not passed on", () => {
    for (const bad of [
      "",
      "   ",
      "nicolas",
      "nicolas@",
      "@example.com",
      "a@b",
      "a@@b.com",
      "two words@example.com",
      "a@example.",
    ]) {
      assert.deepEqual(readRecipients(bad), [], `accepted ${JSON.stringify(bad)}`);
    }
  });
});

describe("whether it can send at all", () => {
  test("both halves present", () => {
    const config = readEmailConfig({
      RESEND_API_KEY: "re_test",
      NOTIFY_EMAIL_TO: "nicolas@example.com",
    });
    assert.equal(config.canSend, true);
    assert.deepEqual(config.to, ["nicolas@example.com"]);
    assert.equal(emailSetupHint(config), "");
  });

  test("no key means no send, and the hint names the key", () => {
    const config = readEmailConfig({ NOTIFY_EMAIL_TO: "nicolas@example.com" });
    assert.equal(config.canSend, false);
    assert.match(emailSetupHint(config), /RESEND_API_KEY/);
  });

  test("a recipient that is set but unusable is called out as such", () => {
    // Distinct from "not set". Somebody who pasted their name into the box has
    // a different problem from somebody who never filled it in, and being told
    // "NOTIFY_EMAIL_TO" when it plainly is set sends them looking in the wrong
    // place — the same failure that cost an evening on the service-account key.
    const config = readEmailConfig({ RESEND_API_KEY: "re_test", NOTIFY_EMAIL_TO: "Nicolas" });
    assert.equal(config.canSend, false);
    assert.match(emailSetupHint(config), /set but holds no usable address/);
  });

  test("the sender falls back rather than failing", () => {
    const config = readEmailConfig({ RESEND_API_KEY: "re_test", NOTIFY_EMAIL_TO: "a@b.com" });
    assert.equal(config.from, DEFAULT_FROM);
    assert.equal(config.canSend, true);
  });

  test("a configured sender wins", () => {
    const config = readEmailConfig({
      RESEND_API_KEY: "re_test",
      NOTIFY_EMAIL_TO: "a@b.com",
      NOTIFY_EMAIL_FROM: "Grime Busters <quotes@grimebusterskyllc.com>",
    });
    assert.equal(config.from, "Grime Busters <quotes@grimebusterskyllc.com>");
  });
});

describe("dates read as the customer picked them", () => {
  test("a plain date", () => {
    assert.equal(spellDate("2026-09-12"), "September 12, 2026");
  });

  test("the first of the month does not lose a day", () => {
    // Constructing a Date from this string would give midnight UTC, which is
    // the previous evening in Kentucky — and the crew would show up a day late.
    assert.equal(spellDate("2026-01-01"), "January 1, 2026");
    assert.equal(spellDate("2026-12-31"), "December 31, 2026");
  });

  test("anything unexpected is passed through rather than mangled", () => {
    assert.equal(spellDate("soon"), "soon");
    assert.equal(spellDate("2026-13-01"), "2026-13-01");
  });
});

describe("escaping, which is the reason this file has no imports", () => {
  test("the five characters that matter", () => {
    assert.equal(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
  });

  test("a script tag in the signed name cannot reach the inbox as markup", () => {
    const email = acceptedEmail({
      ...NOTICE,
      customerName: `<script>alert(1)</script>`,
      signedName: `<img src=x onerror=alert(1)>`,
    });
    assert.ok(!email.html.includes("<script>"), "raw script tag survived into the HTML");
    assert.ok(!email.html.includes("<img src=x"), "raw img tag survived into the HTML");
    assert.ok(email.html.includes("&lt;script&gt;"), "the name was dropped instead of escaped");
  });

  test("a quote in the message cannot break out of an attribute", () => {
    const email = acceptedEmail({
      ...NOTICE,
      message: `" onmouseover="alert(1)`,
    });
    assert.ok(!email.html.includes(`onmouseover="alert(1)"`));
    assert.ok(email.html.includes("&quot;"));
  });

  test("the document link is escaped too", () => {
    const email = acceptedEmail({
      ...NOTICE,
      documentUrl: `https://example.com/"><script>alert(1)</script>`,
    });
    assert.ok(!email.html.includes("<script>"));
  });

  test("the plain-text part is left alone — it is not markup", () => {
    const email = acceptedEmail({ ...NOTICE, message: "Is <$400> possible?" });
    assert.ok(email.text.includes("Is <$400> possible?"));
  });
});

describe("what the notice actually says", () => {
  test("the subject alone is enough to act on", () => {
    const email = acceptedEmail(NOTICE);
    assert.equal(email.subject, "Marta Oakley approved EST-1042 — $420.00");
  });

  test("the facts all appear in both parts", () => {
    const email = acceptedEmail(NOTICE);
    for (const part of [email.text, email.html]) {
      assert.match(part, /EST-1042/);
      assert.match(part, /Pressure washing/);
      assert.match(part, /\$420\.00/);
      assert.match(part, /September 12, 2026/);
    }
  });

  test("a note from the customer is included when there is one", () => {
    const email = acceptedEmail({ ...NOTICE, message: "Please come to the side gate." });
    assert.match(email.text, /They said: Please come to the side gate\./);
    assert.match(email.html, /Please come to the side gate\./);
  });

  test("and no empty row is left behind when there is not", () => {
    const email = acceptedEmail(NOTICE);
    assert.ok(!email.text.includes("They said"));
    assert.ok(!email.html.includes("They said"));
  });

  test("a nameless customer still produces a sentence that reads", () => {
    // A pin dropped at a door has an address and no name, and it can be quoted.
    const email = acceptedEmail({ ...NOTICE, customerName: "", signedName: "" });
    assert.equal(email.subject, "A customer approved EST-1042 — $420.00");
    assert.ok(!email.subject.includes("undefined"));
  });

  test("no link section when no site URL was configured", () => {
    const email = acceptedEmail({ ...NOTICE, documentUrl: "" });
    assert.ok(!email.html.includes("<a href"));
    assert.ok(!email.text.includes("Open it in the CRM"));
  });

  test("the signature is described, never attached", () => {
    // It is a 200 KB data URL. Mail clients strip them, and the estimate in the
    // CRM is where it belongs anyway.
    const email = acceptedEmail(NOTICE);
    assert.match(email.text, /signature is on the estimate in the CRM/);
    assert.ok(!email.html.includes("data:image"));
  });
});
