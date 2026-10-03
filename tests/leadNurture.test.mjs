/**
 * Who gets a nurture text, and — mostly — who does not.
 *
 * This is the only code in the app that texts somebody who has never replied,
 * which makes it the only code where a bug reaches a stranger. The failure
 * modes are not crashes: they are a message to a person who said stop, three
 * messages in three days to a lead from last spring, or a marketing text sent
 * on a verbal yes at a door. None of those throw, none appear in a log anybody
 * reads, and each one is a real text that cannot be recalled.
 *
 * So the refusals are what is pinned hardest below. The happy path is four
 * assertions; the ways this must decline are twenty.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  nurtureDecision,
  hasInboundNote,
  oneLeadPerPhone,
  NURTURE_STEPS,
  MIN_GAP_DAYS,
  MAX_AGE_TO_START_DAYS,
} = await import("../lib/leadNurture.ts");
const { leadNurtureText } = await import("../lib/messages.ts");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-06-15T14:00:00Z");

/** A lead who ticked the box on the website four days ago and went quiet. */
const quietLead = {
  pipelineStage: "new_lead",
  status: "lead",
  createdAtMs: NOW - 4 * DAY,
  nurtureStep: 0,
  lastNurtureAtMs: null,
  hasReplied: false,
  phone: "(502) 555-0147",
  consent: { granted: true, method: "web_form" },
  optedOut: false,
};

const decide = (patch = {}, now = NOW) => nurtureDecision({ ...quietLead, ...patch }, now);

describe("the sequence itself", () => {
  test("three steps, in the first month, and no more", () => {
    // The shape is the policy. A fourth step, or a step at day 90, is a
    // decision somebody has to make on purpose — not something that arrives
    // because this array was edited without reading why it is short.
    assert.equal(NURTURE_STEPS.length, 3);
    assert.deepEqual(
      NURTURE_STEPS.map((s) => s.day),
      [3, 10, 30],
    );
    assert.deepEqual(
      NURTURE_STEPS.map((s) => s.kind),
      ["nudge", "value", "last_call"],
    );
  });

  test("a quiet lead past day 3 gets the first text", () => {
    const verdict = decide();
    assert.equal(verdict.send, true);
    assert.equal(verdict.step, 0);
    assert.equal(verdict.kind, "nudge");
  });

  test("each step waits for its own day", () => {
    const old = { createdAtMs: NOW - 40 * DAY, lastNurtureAtMs: NOW - 10 * DAY };
    assert.equal(decide({ ...old, nurtureStep: 1 }).kind, "value");
    assert.equal(decide({ ...old, nurtureStep: 2 }).kind, "last_call");
  });

  test("step 2 is refused on day 4, however many days old the lead is", () => {
    const verdict = decide({ nurtureStep: 1 });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /not due until day 10/);
  });

  test("after the third, the sequence is over", () => {
    const verdict = decide({
      nurtureStep: 3,
      createdAtMs: NOW - 200 * DAY,
      lastNurtureAtMs: NOW - 100 * DAY,
    });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /finished/);
  });

  test("and stays over — a fourth text is not reachable by any input", () => {
    // Walked rather than asserted once, because "the sequence ends" is the
    // promise the day-30 message makes out loud: "I won't keep texting."
    for (const step of [3, 4, 9, 100]) {
      for (const age of [31, 90, 400]) {
        const verdict = decide({
          nurtureStep: step,
          createdAtMs: NOW - age * DAY,
          lastNurtureAtMs: NOW - 60 * DAY,
        });
        assert.equal(verdict.send, false, `step ${step}, age ${age}`);
      }
    }
  });
});

describe("the ways this must refuse", () => {
  test("somebody who replied STOP", () => {
    const verdict = decide({ optedOut: true });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /STOP/);
  });

  test("an opt-out outranks everything, including a fresh consent", () => {
    // The order in nurtureDecision is load-bearing. Somebody who said stop and
    // was then ticked as consenting has been overridden by a colleague, not
    // persuaded.
    const verdict = decide({
      optedOut: true,
      consent: { granted: true, method: "written" },
    });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /STOP/);
  });

  test("somebody who has written back, ever", () => {
    const verdict = decide({ hasReplied: true });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /replied/);
  });

  test("a lead who has moved past new_lead", () => {
    // quote-followups chases these. Two crons texting one person about one
    // quote on one day is the thing this check exists to prevent.
    for (const stage of [
      "estimate_sent",
      "estimate_accepted",
      "job_scheduled",
      "awaiting_payment",
      "paid",
      "lost",
    ]) {
      const verdict = decide({ pipelineStage: stage });
      assert.equal(verdict.send, false, stage);
      assert.match(verdict.reason, /not a new lead/);
    }
  });

  test("do not knock means do not text either", () => {
    const verdict = decide({ status: "do_not_knock" });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /do not knock/);
  });

  test("no phone number", () => {
    for (const phone of ["", "   "]) {
      assert.equal(decide({ phone }).send, false, JSON.stringify(phone));
    }
  });
});

describe("consent, which is the strictest gate here", () => {
  test("a web form or something written is enough", () => {
    assert.equal(decide({ consent: { granted: true, method: "web_form" } }).send, true);
    assert.equal(decide({ consent: { granted: true, method: "written" } }).send, true);
  });

  test("a verbal yes is not, for a marketing text", () => {
    // Not an oversight and not a bug to be fixed later: a nurture text exists
    // to win work, which is a higher bar than servicing a job already agreed.
    // Verbal-consent leads get calls and door knocks instead.
    const verdict = decide({ consent: { granted: true, method: "verbal" } });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /web form or something written/);
  });

  test("no consent record at all is not consent", () => {
    // Most older records have none. "We never asked" must never read as yes.
    const verdict = decide({ consent: null });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /no written or web-form consent/);
  });

  test("a recorded no is a no, whatever the method", () => {
    for (const method of ["web_form", "written", "verbal"]) {
      const verdict = decide({ consent: { granted: false, method } });
      assert.equal(verdict.send, false, method);
    }
  });
});

describe("the two guards that stop a burst", () => {
  test("an old lead never starts the sequence", () => {
    // The day this ships, the database holds every lead ever entered. Without
    // this, the first run would text all of them — a spam pattern arriving by
    // accident on day one, on a number whose A2P campaign took weeks to get.
    const verdict = decide({ createdAtMs: NOW - (MAX_AGE_TO_START_DAYS + 1) * DAY });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /too old to start/);
  });

  test("a lead just inside the window still starts", () => {
    const verdict = decide({ createdAtMs: NOW - (MAX_AGE_TO_START_DAYS - 1) * DAY });
    assert.equal(verdict.send, true);
  });

  test("the age guard applies only to starting, not to continuing", () => {
    // A lead who got step 1 at day 3 is 40 days old by step 3. That is the
    // sequence working, not a stale lead, so the guard must not catch it.
    const verdict = decide({
      nurtureStep: 2,
      createdAtMs: NOW - 60 * DAY,
      lastNurtureAtMs: NOW - 20 * DAY,
    });
    assert.equal(verdict.send, true);
    assert.equal(verdict.kind, "last_call");
  });

  test("two texts cannot land inside the minimum gap", () => {
    // The step days are measured from creation, so a lead who sat 40 days
    // satisfies day 3, day 10 and day 30 at once. Without the gap, three runs
    // on three consecutive days would send all three.
    const verdict = decide({
      nurtureStep: 1,
      createdAtMs: NOW - 40 * DAY,
      lastNurtureAtMs: NOW - 1 * DAY,
    });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /minimum gap/);
  });

  test("the whole sequence cannot be walked in under the gap, day by day", () => {
    // The regression test for the shape of that bug rather than one instance:
    // simulate a 40-day-old lead through a daily cron and count the sends.
    let step = 0;
    let lastAt = null;
    let sends = 0;
    const createdAtMs = NOW - 40 * DAY;

    for (let day = 0; day < 14; day += 1) {
      const at = NOW + day * DAY;
      const verdict = nurtureDecision(
        { ...quietLead, createdAtMs, nurtureStep: step, lastNurtureAtMs: lastAt },
        at,
      );
      if (verdict.send) {
        sends += 1;
        step += 1;
        lastAt = at;
      }
    }

    assert.equal(sends, 3, "all three still go out, eventually");
    // 14 days, 3 sends, minimum 5 days apart: the first on day 0, then day 5,
    // then day 10. Never two in a row.
    assert.ok(MIN_GAP_DAYS >= 5, "the arithmetic above assumes a gap of at least 5 days");
  });

  test("every refusal says why, in words", () => {
    // "Nothing happened" is unanswerable on a job that runs at 10am unattended.
    const refusals = [
      { optedOut: true },
      { hasReplied: true },
      { pipelineStage: "paid" },
      { status: "do_not_knock" },
      { phone: "" },
      { consent: null },
      { consent: { granted: true, method: "verbal" } },
      { nurtureStep: 3 },
      { createdAtMs: NOW - 400 * DAY },
      { nurtureStep: 1, lastNurtureAtMs: NOW - 1 * DAY, createdAtMs: NOW - 40 * DAY },
      { nurtureStep: 1 },
    ];
    for (const patch of refusals) {
      const verdict = decide(patch);
      assert.equal(verdict.send, false, JSON.stringify(patch));
      assert.ok(
        verdict.reason && verdict.reason.length > 10,
        `thin reason for ${JSON.stringify(patch)}: ${verdict.reason}`,
      );
    }
  });
});

describe("spotting a reply", () => {
  test("an inbound text ends the sequence", () => {
    assert.equal(hasInboundNote(["lead_import", "sms_out", "sms_in"]), true);
  });

  test("our own outbound messages are not a reply", () => {
    // The nurture texts themselves land on the timeline as sms_out. Reading
    // those as a reply would make the sequence stop after its own first
    // message, which is a silent failure — it looks like it is working.
    assert.equal(hasInboundNote(["sms_out", "sms_out", "note", "quote"]), false);
  });

  test("no notes at all is not a reply", () => {
    assert.equal(hasInboundNote([]), false);
  });
});

describe("what the lead actually reads", () => {
  const kinds = ["nudge", "value", "last_call"];

  test("all three carry the opt-out line", () => {
    // tests/messages.test.mjs walks the module and only exercises one branch of
    // this template, so the other two are checked here.
    for (const kind of kinds) {
      assert.match(leadNurtureText(kind, "Marta"), /Reply STOP to opt out\./, kind);
    }
  });

  test("all three name the business", () => {
    for (const kind of kinds) {
      assert.match(leadNurtureText(kind, "Marta"), /Grime Busters/, kind);
    }
  });

  test("a lead with no first name still gets a sentence", () => {
    for (const kind of kinds) {
      assert.match(leadNurtureText(kind, null), /^Hi there,/, kind);
    }
  });

  test("the last one says it is the last one", () => {
    // The promise that makes a three-step sequence defensible. If this wording
    // goes, the sequence is just three texts that stop for no stated reason.
    assert.match(leadNurtureText("last_call", "Marta"), /won't keep texting/);
  });

  test("none of them asks whether they have decided yet", () => {
    // "Just checking in" is the message that gets reported as spam: it costs
    // the reader attention and gives them nothing.
    for (const kind of kinds) {
      const text = leadNurtureText(kind, "Marta").toLowerCase();
      assert.ok(!text.includes("just checking in"), kind);
      assert.ok(!text.includes("following up"), kind);
    }
  });

  test("each is a distinct message", () => {
    const texts = kinds.map((k) => leadNurtureText(k, "Marta"));
    assert.equal(new Set(texts).size, 3);
  });
});

describe("a corrupt step counter", () => {
  // Found by Codex review on #60, and worse than it first looked: a negative
  // or fractional step indexed past the end of NURTURE_STEPS, and reading
  // `.day` off the undefined threw. The route had one try around the whole
  // loop, so one bad record ended the run and nobody got nurtured — and
  // firestore.rules guarded these counters on update but not on create, which
  // made it reachable from a client.
  test("never throws, whatever is in the field", () => {
    for (const nurtureStep of [-1, -99, 0.5, 2.7, NaN, Infinity, -Infinity]) {
      const verdict = decide({ nurtureStep });
      assert.equal(verdict.send, false, String(nurtureStep));
      assert.match(verdict.reason, /not a whole count/, String(nurtureStep));
    }
  });

  test("a whole count still works", () => {
    assert.equal(decide({ nurtureStep: 0 }).send, true);
  });
});

describe("one person, several records", () => {
  // The Meta webhook creates a fresh customer per form submission rather than
  // matching an existing one, so one handset can sit in the database three
  // times. An inbound reply attaches to only one of them.
  const lead = (id, patch = {}) => ({
    id,
    phoneKey: "5025550147",
    nurtureStep: 0,
    hasReplied: false,
    optedOut: false,
    ...patch,
  });

  test("three records for one number send at most one text", () => {
    const { chosen, setAside } = oneLeadPerPhone([lead("a"), lead("b"), lead("c")]);
    assert.equal(chosen.length, 1);
    assert.equal(setAside.length, 2);
    for (const entry of setAside) {
      assert.match(entry.reason, /another record for this number/);
    }
  });

  test("the record furthest through the sequence is the one that sends", () => {
    // The duplicates behind it would replay messages this person already had.
    const { chosen } = oneLeadPerPhone([
      lead("behind", { nurtureStep: 0 }),
      lead("ahead", { nurtureStep: 2 }),
      lead("middle", { nurtureStep: 1 }),
    ]);
    assert.equal(chosen[0].id, "ahead");
  });

  test("a reply on ANY record stops the whole number", () => {
    // This is the finding. Without it, a lead who answered kept getting texts
    // from the duplicate records that did not carry their reply.
    const { chosen, setAside } = oneLeadPerPhone([
      lead("replied", { hasReplied: true }),
      lead("duplicate"),
      lead("another"),
    ]);
    assert.deepEqual(chosen, []);
    assert.equal(setAside.length, 3);
    for (const entry of setAside) assert.match(entry.reason, /has replied/);
  });

  test("an opt-out on ANY record stops the whole number", () => {
    const { chosen, setAside } = oneLeadPerPhone([
      lead("duplicate"),
      lead("stopped", { optedOut: true }),
    ]);
    assert.deepEqual(chosen, []);
    for (const entry of setAside) assert.match(entry.reason, /STOP/);
  });

  test("an opt-out outranks a reply in the wording, and both stop everything", () => {
    const { chosen } = oneLeadPerPhone([
      lead("x", { hasReplied: true, optedOut: true }),
      lead("y"),
    ]);
    assert.deepEqual(chosen, []);
  });

  test("different numbers are different people", () => {
    const { chosen } = oneLeadPerPhone([
      lead("a", { phoneKey: "5025550147" }),
      lead("b", { phoneKey: "5025559999" }),
    ]);
    assert.equal(chosen.length, 2);
  });

  test("one number replying does not silence a different number", () => {
    const { chosen } = oneLeadPerPhone([
      lead("replied", { phoneKey: "5025550147", hasReplied: true }),
      lead("innocent", { phoneKey: "5025559999" }),
    ]);
    assert.deepEqual(chosen.map((l) => l.id), ["innocent"]);
  });

  test("a record with no usable number is set aside, not texted", () => {
    const { chosen, setAside } = oneLeadPerPhone([lead("nophone", { phoneKey: "" })]);
    assert.deepEqual(chosen, []);
    assert.match(setAside[0].reason, /no usable phone number/);
  });

  test("nothing in, nothing out", () => {
    assert.deepEqual(oneLeadPerPhone([]), { chosen: [], setAside: [] });
  });

  test("the choice is stable across runs over the same data", () => {
    // Two runs picking different records would replay a message.
    const leads = [lead("a", { nurtureStep: 1 }), lead("b", { nurtureStep: 1 })];
    const first = oneLeadPerPhone(leads).chosen[0].id;
    const second = oneLeadPerPhone(leads).chosen[0].id;
    assert.equal(first, second);
  });
});
