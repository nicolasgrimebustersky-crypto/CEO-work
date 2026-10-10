/**
 * Who a group text goes to.
 *
 * The rule that needed testing most is "has this person already had this
 * message", because both ways of getting it wrong cost something real. A false
 * yes silently drops somebody out of a send the owner thinks reached everyone.
 * A false no sends the same promotion twice, which is what gets a number
 * reported — and a reported number takes down every text the business sends,
 * job confirmations included.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";

const { sameMessage, hasReceivedMessage, blockFor, splitAudience } = await import(
  "../lib/blastAudience.ts"
);
// The real thing, not a stand-in. These tests are the only place the screen's
// consent rule and the server's consent rule are checked against each other,
// so a copy of canSendTo here would defeat the point of the exercise.
const { canSendTo } = await import("../lib/smsConsent.ts");

/** splitAudience as the sheet calls it, with the production consent check. */
const split = (group, body, removed = new Set()) =>
  splitAudience(group, body, removed, canSendTo);
const block = (customer) => blockFor(customer, canSendTo);

const FALL = `Grime Busters KY LLC: Hey with fall temperatures comes fall mess and we would love to make sure your grass stays uncluttered going into these cold temperatures! BOOK NOW and get 20% off leaf removal!

Call us today at 502-599-6855 or sign up online at grimebusterskyllc.com!`;

const who = (id, patch = {}) => ({
  id,
  phone: "(502) 555-0147",
  status: "lead",
  notes: [],
  ...patch,
});
const sent = (text) => ({ text, kind: "sms_out" });

describe("the same message, recognised", () => {
  test("identical text matches", () => {
    assert.equal(sameMessage(FALL, FALL), true);
  });

  test("a line break that became a space still matches", () => {
    // What comes back from Firestore and what is typed into a box differ in
    // ways nobody means. Treating those as different messages would send the
    // whole blast twice.
    assert.equal(sameMessage(FALL, FALL.replace(/\n+/g, " ")), true);
  });

  test("trailing whitespace and case do not matter", () => {
    assert.equal(sameMessage(`  ${FALL}\n`, FALL.toUpperCase()), true);
  });

  test("a different offer sharing an opening line does not match", () => {
    // The dangerous direction. Two promotions that start the same way are two
    // messages, and calling them one drops people out of the second send.
    const spring = FALL.replace("20% off leaf removal", "15% off gutter clearing");
    assert.equal(sameMessage(FALL, spring), false);
  });

  test("a message that merely contains the other does not match", () => {
    assert.equal(sameMessage(FALL, `${FALL} Reply STOP to opt out.`), false);
  });

  test("an empty draft matches nothing", () => {
    // Otherwise every customer with any outbound text looks like they have
    // already had the blank message, and the recipient count reads 0 before a
    // word is typed.
    assert.equal(sameMessage("", ""), false);
    assert.equal(sameMessage("   ", FALL), false);
  });
});

describe("who has already had it", () => {
  test("an outbound text with this body counts", () => {
    assert.equal(hasReceivedMessage([sent(FALL)], FALL), true);
  });

  test("an inbound message quoting it back does not", () => {
    // Them repeating our words to us is not us having sent it again.
    assert.equal(hasReceivedMessage([{ text: FALL, kind: "sms_in" }], FALL), false);
  });

  test("a typed note containing the wording does not", () => {
    assert.equal(hasReceivedMessage([{ text: FALL, kind: "note" }], FALL), false);
  });

  test("no notes, or none matching, reads as not sent", () => {
    assert.equal(hasReceivedMessage([], FALL), false);
    assert.equal(hasReceivedMessage(null, FALL), false);
    assert.equal(hasReceivedMessage([sent("On my way!")], FALL), false);
  });

  test("an empty body is never 'already sent'", () => {
    assert.equal(hasReceivedMessage([sent(FALL)], ""), false);
  });
});

describe("who cannot be texted at all", () => {
  test("do not knock, and no phone", () => {
    assert.equal(block(who("a", { status: "do_not_knock" })).reason, "do not knock");
    assert.equal(block(who("b", { phone: "" })).reason, "no phone");
    assert.equal(block(who("c", { phone: "   " })).reason, "no phone");
    assert.equal(block(who("d")), null);
  });

  test("somebody who replied STOP", () => {
    // The finding. /api/sms/blast has always refused these; the screen did
    // not ask, so it counted them as recipients and the owner was told a
    // number that included people the server would turn away.
    const stopped = block(who("s", { smsOptOut: { at: "2026-09-01T10:00:00Z", keyword: "stop" } }));
    assert.equal(stopped.reason, "cannot be texted");
    assert.match(stopped.detail, /STOP/, "the screen says which refusal it was");
  });

  test("somebody who declined texts when asked", () => {
    const declined = block(
      who("d", {
        smsConsent: { granted: false, method: "verbal", at: "2026-09-01T10:00:00Z", byUid: "u", byName: "Nick" },
      }),
    );
    assert.equal(declined.reason, "cannot be texted");
    assert.match(declined.detail, /declined/i);
  });

  test("a recorded yes, and no record at all, are both fine", () => {
    // A missing consent record is every customer entered before consent was
    // tracked. Refusing them would mean a business that cannot text its own
    // customers the day this ships.
    assert.equal(
      block(
        who("y", {
          smsConsent: { granted: true, method: "verbal", at: "2026-09-01T10:00:00Z", byUid: "u", byName: "Nick" },
        }),
      ),
      null,
    );
    assert.equal(block(who("none")), null);
  });

  test("an opt-out beats a consent recorded afterwards", () => {
    // Delegated to canSendTo, which is the point of delegating: this ordering
    // is decided in one place and the screen cannot disagree with the server.
    const out = block(
      who("x", {
        smsOptOut: { at: "2026-09-01T10:00:00Z", keyword: "stop" },
        smsConsent: { granted: true, method: "verbal", at: "2026-09-02T10:00:00Z", byUid: "u", byName: "Nick" },
      }),
    );
    assert.equal(out.reason, "cannot be texted");
    assert.match(out.detail, /STOP/);
  });
});

describe("an opt-out cannot be overridden from this screen", () => {
  const stopped = (id, patch = {}) =>
    who(id, { smsOptOut: { at: "2026-09-01T10:00:00Z", keyword: "stop" }, ...patch });

  test("they are blocked, not counted as a recipient", () => {
    const out = split([stopped("s"), who("fresh")], FALL);
    assert.deepEqual(out.sendable.map((c) => c.id), ["fresh"]);
    assert.deepEqual(out.blocked.map((b) => b.customer.id), ["s"]);
  });

  test("and not filed as having already had it", () => {
    // The worst of the old readings: the screen claiming we had already sent
    // a promotion to somebody who told us to stop.
    const out = split([stopped("s")], FALL);
    assert.equal(out.alreadySent.length, 0);
    assert.equal(out.blocked.length, 1);
  });

  test("'Send to them anyway' cannot reach them", () => {
    // That toggle adds alreadySent to the send. An opted-out customer must
    // never be in that pile, so there is no path from the toggle to them.
    const out = split([stopped("s", { notes: [sent(FALL)] })], FALL);
    const withToggleOn = [...out.sendable, ...out.alreadySent];
    assert.deepEqual(withToggleOn, [], "no toggle on this screen can include them");
  });

  test("removing and adding back does not launder them into the send", () => {
    const out = split([stopped("s")], FALL, new Set(["s"]));
    assert.equal(out.removed.length, 0);
    assert.equal(out.blocked[0].reason, "cannot be texted");
  });
});

describe("splitting the group on screen", () => {
  test("the four piles are what the screen shows", () => {
    const group = [
      who("fresh"),
      who("had_it", { notes: [sent(FALL)] }),
      who("struck"),
      who("blocked", { status: "do_not_knock" }),
      who("nophone", { phone: "" }),
    ];
    const out = split(group, FALL, new Set(["struck"]));
    assert.deepEqual(out.sendable.map((c) => c.id), ["fresh"]);
    assert.deepEqual(out.alreadySent.map((c) => c.id), ["had_it"]);
    assert.deepEqual(out.removed.map((c) => c.id), ["struck"]);
    assert.deepEqual(
      out.blocked.map((b) => `${b.customer.id}:${b.reason}`),
      ["blocked:do not knock", "nophone:no phone"],
    );
  });

  test("unable to be texted outranks already having had it", () => {
    // A do-not-knock customer is not "already sent", they are off limits, and
    // the screen must say the reason that is actually true of them.
    const out = split(
      [who("x", { status: "do_not_knock", notes: [sent(FALL)] })],
      FALL,
      new Set(),
    );
    assert.equal(out.alreadySent.length, 0);
    assert.equal(out.blocked[0].reason, "do not knock");
  });

  test("unable to be texted outranks being taken out by hand, too", () => {
    // Striking somebody out is a preference; do-not-knock is an instruction.
    // If removing them reclassified the row, the screen would stop saying the
    // true reason — and adding them back would quietly put an off-limits
    // customer into the send.
    const out = split(
      [who("x", { status: "do_not_knock" })],
      FALL,
      new Set(["x"]),
    );
    assert.equal(out.removed.length, 0);
    assert.deepEqual(
      out.blocked.map((b) => `${b.customer.id}:${b.reason}`),
      ["x:do not knock"],
    );
  });

  test("being taken out by hand outranks already having had it", () => {
    // Somebody made a decision on this screen; it should hold, and the row
    // should read as removed rather than quietly reclassified.
    const out = split([who("x", { notes: [sent(FALL)] })], FALL, new Set(["x"]));
    assert.deepEqual(out.removed.map((c) => c.id), ["x"]);
    assert.equal(out.alreadySent.length, 0);
  });

  test("before anything is typed, nobody counts as already sent", () => {
    const out = split([who("a", { notes: [sent(FALL)] })], "", new Set());
    assert.deepEqual(out.sendable.map((c) => c.id), ["a"]);
    assert.equal(out.alreadySent.length, 0);
  });

  test("removing somebody does not disturb anyone else", () => {
    const group = [who("a"), who("b"), who("c")];
    const out = split(group, FALL, new Set(["b"]));
    assert.deepEqual(out.sendable.map((c) => c.id), ["a", "c"]);
  });

  test("the caller's own record type comes back, not a narrowed copy", () => {
    // The sheet needs the full Customer to show a name and a number.
    const out = split([who("a", { firstName: "Marta" })], FALL, new Set());
    assert.equal(out.sendable[0].firstName, "Marta");
  });
});

describe("the skipped list is inspectable, not just counted", () => {
  // Codex's finding on the first version of the sheet. It showed three names
  // of however many, and the only way to see the rest was "Send to them
  // anyway" — which is the one thing somebody checking the list is trying not
  // to do by accident. A number you cannot check is not an answer to "tell me
  // who has not had this".
  const SOURCE = readFileSync(
    new URL("../components/customers/BlastSheet.tsx", import.meta.url),
    "utf8",
  );
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  test("splitAudience reports every match, not a sample", () => {
    // The rule underneath has to carry the whole set or no screen can show it.
    const group = Array.from({ length: 9 }, (_, i) =>
      who(`had_${i}`, { notes: [sent(FALL)] }),
    );
    const out = split([...group, who("fresh")], FALL, new Set());
    assert.equal(out.alreadySent.length, 9, "all nine, not the first three");
    assert.deepEqual(out.sendable.map((c) => c.id), ["fresh"]);
  });

  test("the sheet can expand the whole skipped list", () => {
    assert.match(code, /setSentOpen/, "the skipped group has its own expander");
    assert.match(
      code,
      /audience\.alreadySent\.map\(/,
      "and maps every one of them, rather than only a slice",
    );
  });

  test("seeing them does not put them in the send", () => {
    // The expander and the include toggle are separate controls. If opening
    // the list changed who gets texted, checking would be the dangerous act.
    assert.notEqual(
      code.includes("setSentOpen"),
      code.includes("setSentOpen((v) => !v);\n                    setIncludeSent"),
      "expanding must not touch includeSent",
    );
    assert.match(code, /onClick=\{\(\) => setIncludeSent\(\(v\) => !v\)\}/);
  });

  test("the two lists expand independently", () => {
    // Checking who is being skipped should not collapse the recipient list
    // you were halfway through editing.
    assert.match(code, /const \[listOpen, setListOpen\]/);
    assert.match(code, /const \[sentOpen, setSentOpen\]/);
  });
});

describe("the cannot-be-texted list is inspectable too", () => {
  // The blocked bucket had the same defect the skipped list had — three names
  // and an ellipsis. It matters more here: once consent is checked, one of
  // these rows is a person who replied STOP, and seeing that by name is how
  // the crew learns to phone them instead of wondering why they went quiet.
  //
  // These are source assertions, which only prove the JSX says this. What the
  // blocked bucket actually contains, and that nothing can move anyone out of
  // it into the send, is covered by the running tests above.
  const SOURCE = readFileSync(
    new URL("../components/customers/BlastSheet.tsx", import.meta.url),
    "utf8",
  );
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  test("splitAudience reports every blocked person, not a sample", () => {
    const group = Array.from({ length: 7 }, (_, i) =>
      who(`stop_${i}`, { smsOptOut: { at: "2026-09-01T10:00:00Z", keyword: "stop" } }),
    );
    const out = split([...group, who("fresh")], FALL);
    assert.equal(out.blocked.length, 7, "all seven, not the first three");
    assert.ok(
      out.blocked.every((b) => b.detail && b.detail.length > 0),
      "each one carries its own reason, so the list can say why",
    );
  });

  test("the sheet has its own expander for them", () => {
    assert.match(code, /const \[blockedOpen, setBlockedOpen\]/);
    assert.match(code, /audience\.blocked\.map\(/, "maps every one, not a slice");
    assert.match(code, /\{item\.detail\}/, "and shows each person's own reason");
  });

  test("the sheet asks the server's own consent function", () => {
    // Not a second opinion written for the screen. If this ever stops being
    // canSendTo, the count can disagree with what the send actually does.
    assert.match(code, /from "@\/lib\/smsConsent"/);
    assert.match(code, /splitAudience\(recipients, body, removed, canSendTo\)/);
  });

  test("no control offers to include them", () => {
    // There is a "Send to them anyway" for the already-had-it group. There
    // must not be one here: an opt-out is the customer's own instruction.
    const blockedBlock = code.slice(code.indexOf("audience.blocked.length > 0"));
    assert.doesNotMatch(
      blockedBlock,
      /setIncludeBlocked|includeBlocked/,
      "nothing on this screen may overrule an opt-out",
    );
  });
});
