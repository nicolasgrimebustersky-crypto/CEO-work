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
  claimVerdict,
  claimDecision,
  claimStillOwns,
  sendStateFrom,
  mayRelease,
  consumesCapacity,
  recordIsSendable,
  pickOpenQuote,
  NURTURE_STEPS,
  MIN_GAP_DAYS,
  MAX_AGE_TO_START_DAYS,
} = await import("../lib/leadNurture.ts");
const { leadNurtureText } = await import("../lib/messages.ts");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-06-15T14:00:00Z");

/** A lead who ticked the box on the website four days ago and went quiet. */
const quietLead = {
  pipelineStage: "estimate_sent",
  quoteStatus: "sent",
  status: "lead",
  quoteSentAtMs: NOW - 4 * DAY,
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
    const old = { quoteSentAtMs: NOW - 40 * DAY, lastNurtureAtMs: NOW - 10 * DAY };
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
      quoteSentAtMs: NOW - 200 * DAY,
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
          quoteSentAtMs: NOW - age * DAY,
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

  test("a customer who has nothing open to follow up on", () => {
    // The whole correction this feature needed. The sequence used to target
    // leads with no price against them and refuse the quoted ones, which is
    // backwards: an unanswered estimate is the thing worth chasing, and a
    // stranger with no estimate is the text that gets reported.
    const verdict = decide({ quoteStatus: "" });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /no estimate or quote/);
  });

  test("an estimate that is no longer open", () => {
    // `accepted` matters most of the six. Asking somebody to consider a price
    // they have already agreed to is the message that makes a business look
    // like it does not know it won the work.
    for (const status of ["accepted", "declined", "void", "partial", "paid", "draft"]) {
      const verdict = decide({ quoteStatus: status });
      assert.equal(verdict.send, false, status);
      assert.match(verdict.reason, /not open/);
    }
  });

  test("the two open statuses are the only ones that send", () => {
    for (const status of ["sent", "no_response"]) {
      assert.equal(decide({ quoteStatus: status }).send, true, status);
    }
  });

  test("a customer who has moved past being quoted", () => {
    // They said yes, or somebody wrote them off. Either way the decision has
    // been made and a cron does not get to reopen it.
    for (const stage of ["estimate_accepted", "job_scheduled", "awaiting_payment", "paid", "lost"]) {
      const verdict = decide({ pipelineStage: stage });
      assert.equal(verdict.send, false, stage);
      assert.match(verdict.reason, /moved on/);
    }
  });

  test("but an open estimate behind a stale new_lead stage still sends", () => {
    // A quote written straight onto a customer nobody moved along the board.
    // Refusing it would mean the feature silently does nothing for exactly the
    // people it is for.
    assert.equal(decide({ pipelineStage: "new_lead" }).send, true);
  });

  test("an estimate with no sent date", () => {
    // There is no day 3 without a day 0, and inventing one would start the
    // ladder from a date nobody chose.
    const verdict = decide({ quoteSentAtMs: 0 });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /no sent date/);
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
    const verdict = decide({ quoteSentAtMs: NOW - (MAX_AGE_TO_START_DAYS + 1) * DAY });
    assert.equal(verdict.send, false);
    assert.match(verdict.reason, /too old to start/);
  });

  test("a lead just inside the window still starts", () => {
    const verdict = decide({ quoteSentAtMs: NOW - (MAX_AGE_TO_START_DAYS - 1) * DAY });
    assert.equal(verdict.send, true);
  });

  test("the age guard applies only to starting, not to continuing", () => {
    // A lead who got step 1 at day 3 is 40 days old by step 3. That is the
    // sequence working, not a stale lead, so the guard must not catch it.
    const verdict = decide({
      nurtureStep: 2,
      quoteSentAtMs: NOW - 60 * DAY,
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
      quoteSentAtMs: NOW - 40 * DAY,
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
    const quoteSentAtMs = NOW - 40 * DAY;

    for (let day = 0; day < 14; day += 1) {
      const at = NOW + day * DAY;
      const verdict = nurtureDecision(
        { ...quietLead, quoteSentAtMs, nurtureStep: step, lastNurtureAtMs: lastAt },
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
      { quoteStatus: "" },
      { quoteStatus: "accepted" },
      { status: "do_not_knock" },
      { phone: "" },
      { consent: null },
      { consent: { granted: true, method: "verbal" } },
      { nurtureStep: 3 },
      { quoteSentAtMs: NOW - 400 * DAY },
      { nurtureStep: 1, lastNurtureAtMs: NOW - 1 * DAY, quoteSentAtMs: NOW - 40 * DAY },
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
    lastNurtureAtMs: null,
    hasReplied: false,
    optedOut: false,
    eligible: true,
    // The grouping asks nurtureDecision which records would send, so a
    // fixture has to be a record the policy can actually judge. These
    // defaults are a lead that would send: a web-form consent, a phone
    // number, ten days old and never nurtured.
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    ...patch,
  });

  test("three records for one number send at most one text", () => {
    const { chosen, setAside } = oneLeadPerPhone([lead("a"), lead("b"), lead("c")], NOW);
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
    ], NOW);
    assert.equal(chosen[0].lead.id, "ahead");
  });

  test("a reply on ANY record stops the whole number", () => {
    // This is the finding. Without it, a lead who answered kept getting texts
    // from the duplicate records that did not carry their reply.
    const { chosen, setAside } = oneLeadPerPhone([
      lead("replied", { hasReplied: true }),
      lead("duplicate"),
      lead("another"),
    ], NOW);
    assert.deepEqual(chosen, []);
    assert.equal(setAside.length, 3);
    for (const entry of setAside) assert.match(entry.reason, /has replied/);
  });

  test("an opt-out on ANY record stops the whole number", () => {
    const { chosen, setAside } = oneLeadPerPhone([
      lead("duplicate"),
      lead("stopped", { optedOut: true }),
    ], NOW);
    assert.deepEqual(chosen, []);
    for (const entry of setAside) assert.match(entry.reason, /STOP/);
  });

  test("an opt-out outranks a reply in the wording, and both stop everything", () => {
    const { chosen } = oneLeadPerPhone([
      lead("x", { hasReplied: true, optedOut: true }),
      lead("y"),
    ], NOW);
    assert.deepEqual(chosen, []);
  });

  test("different numbers are different people", () => {
    const { chosen } = oneLeadPerPhone([
      lead("a", { phoneKey: "5025550147" }),
      lead("b", { phoneKey: "5025559999" }),
    ], NOW);
    assert.equal(chosen.length, 2);
  });

  test("one number replying does not silence a different number", () => {
    const { chosen } = oneLeadPerPhone([
      lead("replied", { phoneKey: "5025550147", hasReplied: true }),
      lead("innocent", { phoneKey: "5025559999" }),
    ], NOW);
    assert.deepEqual(chosen.map((c) => c.lead.id), ["innocent"]);
  });

  test("a record with no usable number is set aside, not texted", () => {
    const { chosen, setAside } = oneLeadPerPhone([lead("nophone", { phoneKey: "" })], NOW);
    assert.deepEqual(chosen, []);
    assert.match(setAside[0].reason, /no usable phone number/);
  });

  test("nothing in, nothing out", () => {
    assert.deepEqual(oneLeadPerPhone([], NOW), { chosen: [], setAside: [] });
  });

  test("the choice is stable across runs over the same data", () => {
    // Two runs picking different records would replay a message.
    const leads = [lead("a", { nurtureStep: 1 }), lead("b", { nurtureStep: 1 })];
    const first = oneLeadPerPhone(leads).chosen[0].id;
    const second = oneLeadPerPhone(leads).chosen[0].id;
    assert.equal(first, second);
  });
});

describe("a duplicate that has moved on still speaks for the person", () => {
  // The case the review named, and the one the first fix missed. Querying
  // `new_lead` alone never read the record carrying the reply — and that
  // record is *usually* the one that moved on, because moving it on is what
  // somebody does after they reply. So the sequence kept running on the
  // duplicates, texting a person who had already answered.
  const rec = (id, patch = {}) => ({
    id,
    phoneKey: "5025550147",
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    optedOut: false,
    eligible: true,
    // The grouping asks nurtureDecision which records would send, so a
    // fixture has to be a record the policy can actually judge. These
    // defaults are a lead that would send: a web-form consent, a phone
    // number, ten days old and never nurtured.
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    ...patch,
  });

  test("a reply on a duplicate with no estimate suppresses the quoted one", () => {
    // The voter is ineligible because it has no estimate of its own, not
    // because it moved on — a record that moved on suppresses the whole number
    // by itself, which would make this test pass for the wrong reason.
    const { chosen, setAside } = oneLeadPerPhone([
      rec("no_estimate", { quoteStatus: "", hasReplied: true, eligible: false }),
      rec("fresh"),
    ], NOW);
    assert.equal(chosen.length, 0, "this person already replied — nothing should send");
    assert.deepEqual(
      setAside.map((s) => s.lead.id),
      ["fresh"],
      "only the candidate is reported; the voter was never a candidate",
    );
    assert.match(setAside[0].reason, /replied/);
  });

  test("an opt-out on a duplicate with no estimate suppresses the quoted one", () => {
    const { chosen, setAside } = oneLeadPerPhone([
      rec("no_estimate", { quoteStatus: "", optedOut: true, eligible: false }),
      rec("fresh"),
    ], NOW);
    assert.equal(chosen.length, 0);
    assert.match(setAside[0].reason, /STOP/);
  });

  test("an ineligible record is never the one that sends", () => {
    // Even alone, and even though it looks like the furthest along.
    const { chosen } = oneLeadPerPhone(
      [rec("no_estimate", { quoteStatus: "", nurtureStep: 2, eligible: false })],
      NOW,
    );
    assert.equal(chosen.length, 0);
  });

  test("an ineligible record does not become noise in the run report", () => {
    // Every customer in the business is read now. If each unquoted one
    // produced a 'skipped' line, the nightly output would be the customer
    // list.
    const { chosen, setAside } = oneLeadPerPhone([
      rec("customer_a", { quoteStatus: "", eligible: false }),
      rec("customer_b", { quoteStatus: "", eligible: false, phoneKey: "5025559999" }),
      rec("nophone", { quoteStatus: "", eligible: false, phoneKey: "" }),
    ], NOW);
    assert.equal(chosen.length, 0);
    assert.deepEqual(setAside, [], "records nobody asked to nurture are silent");
  });

  test("the number's progress travels with the record that sends", () => {
    // The old version of this test asserted only that the fresh record was
    // chosen, and a comment claimed the decision would handle the rest. It
    // would not have: the decision was given the record's own counters, which
    // say 0. What stops the replay is the group figures returned here, so
    // those are what gets asserted.
    const { chosen } = oneLeadPerPhone([
      // Ineligible because it has no estimate of its own, not because it
      // moved on — a record that moved on suppresses the whole number, which
      // would make this test pass for the wrong reason.
      rec("no_estimate", { quoteStatus: "", nurtureStep: 2, lastNurtureAtMs: NOW - 2 * DAY, eligible: false }),
      rec("fresh", { nurtureStep: 0, lastNurtureAtMs: null }),
    ], NOW);
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].lead.id, "fresh");
    assert.equal(chosen[0].effectiveStep, 2, "the number has had two messages, not none");
    assert.equal(
      chosen[0].effectiveLastNurtureAtMs,
      NOW - 2 * DAY,
      "the number was texted two days ago, even though this record never was",
    );
  });

  test("an eligible lead with no ineligible siblings is unaffected", () => {
    const { chosen } = oneLeadPerPhone([rec("only")], NOW);
    assert.deepEqual(chosen.map((c) => c.lead.id), ["only"]);
  });
});

describe("two runs overlapping cannot send the same text twice", () => {
  // The first version of this fix claimed on `nurtureStep` alone and I said in
  // writing that the minimum-gap rule would catch the rest. It would not: the
  // counter deliberately does not advance until Twilio accepts, so in the
  // window between one run's claim and its increment the counter still reads
  // what the second run expects — and the gap check runs *before* the
  // transaction, on a copy read at the top of the run. These tests exist
  // because that was wrong in a way that read as correct.
  const state = (patch = {}) => ({
    exists: true,
    freshStep: 0,
    freshLastNurtureAtMs: null,
    expectedStep: 0,
    expectedLastNurtureAtMs: null,
    ...patch,
  });

  test("a clean claim goes ahead", () => {
    assert.deepEqual(claimVerdict(state(), NOW), { claim: true });
  });

  test("two runs reading the same lead, only one sends", () => {
    // A tiny model of the document, claimed the way the transaction claims it.
    let stored = { step: 0, lastNurtureAtMs: null };
    // Both runs read before either wrote — this is the race.
    const runA = { expectedStep: stored.step, expectedLastNurtureAtMs: stored.lastNurtureAtMs };
    const runB = { expectedStep: stored.step, expectedLastNurtureAtMs: stored.lastNurtureAtMs };

    let sends = 0;
    for (const run of [runA, runB]) {
      const verdict = claimVerdict(
        {
          exists: true,
          freshStep: stored.step,
          freshLastNurtureAtMs: stored.lastNurtureAtMs,
          ...run,
        },
        NOW,
      );
      if (verdict.claim) {
        // The claim writes the stamp. The counter does NOT move yet, which is
        // exactly the condition that defeated the counter-only check.
        stored = { ...stored, lastNurtureAtMs: NOW };
        sends += 1;
      }
    }

    assert.equal(sends, 1, "one text, not two");
    assert.equal(stored.step, 0, "the counter has not advanced — Twilio has not answered yet");
  });

  test("the counter-only check would not have caught it", () => {
    // Pinning the actual bug: step matches, stamp has moved. If this ever
    // returns a claim again, the duplicate is back.
    const verdict = claimVerdict(
      state({ freshStep: 0, expectedStep: 0, freshLastNurtureAtMs: NOW }),
      NOW,
    );
    assert.equal(verdict.claim, false);
    assert.match(verdict.reason, /another run claimed/);
  });

  test("a counter that moved on is refused", () => {
    const verdict = claimVerdict(state({ freshStep: 1 }), NOW);
    assert.equal(verdict.claim, false);
    assert.match(verdict.reason, /advanced this lead to step 1/);
  });

  test("a lead deleted mid-run is refused", () => {
    const verdict = claimVerdict(state({ exists: false }), NOW);
    assert.equal(verdict.claim, false);
    assert.match(verdict.reason, /deleted mid-run/);
  });

  test("the gap is re-checked against what is stored, not what was read", () => {
    // Both runs agree on the stamp, but it is two days old. Whatever the
    // decision thought, the database says this person was texted on Saturday.
    const twoDaysAgo = NOW - 2 * DAY;
    const verdict = claimVerdict(
      state({ freshLastNurtureAtMs: twoDaysAgo, expectedLastNurtureAtMs: twoDaysAgo }),
      NOW,
    );
    assert.equal(verdict.claim, false);
    assert.match(verdict.reason, new RegExp(`minimum gap is ${MIN_GAP_DAYS}`));
  });

  test("a stamp older than the gap claims normally", () => {
    const old = NOW - (MIN_GAP_DAYS + 1) * DAY;
    const verdict = claimVerdict(
      state({ freshLastNurtureAtMs: old, expectedLastNurtureAtMs: old }),
      NOW,
    );
    assert.deepEqual(verdict, { claim: true });
  });

  test("a failed send leaves the lead claimable again", () => {
    // The route puts the stamp back on failure and never advances the counter,
    // so the next run reads exactly what the failed one read.
    const restored = { step: 0, lastNurtureAtMs: null };
    const verdict = claimVerdict(
      state({ freshStep: restored.step, freshLastNurtureAtMs: restored.lastNurtureAtMs }),
      NOW + DAY,
    );
    assert.deepEqual(verdict, { claim: true }, "a failure must not spend the step");
  });
});

describe("a duplicate cannot replay what its sibling already sent", () => {
  // The finding this group exists for. Filtering ineligible siblings out of
  // the grouping meant the chosen record carried its own counters — which, for
  // a freshly created duplicate, say nothing has ever been sent. So a sibling
  // that had finished the whole sequence left the number open to starting it
  // again from the top, and a sibling that texted yesterday left it open to
  // texting again today. Both arrive at the exact harm this file exists to
  // prevent, through the back door.
  const base = {
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 40 * DAY,
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    optedOut: false,
  };
  const req = (patch = {}, group = {}) => ({
    cas: {
      exists: true,
      freshStep: 0,
      freshLastNurtureAtMs: null,
      expectedStep: 0,
      expectedLastNurtureAtMs: null,
      ...(patch.cas ?? {}),
    },
    fresh: { ...base, ...(patch.fresh ?? {}) },
    group: { effectiveStep: 0, effectiveLastNurtureAtMs: null, ...group },
    shared: { step: 0, lastNurtureAtMs: null, ...(patch.shared ?? {}) },
    phoneKeys: { expected: "5025550147", fresh: "5025550147", ...(patch.phoneKeys ?? {}) },
  });

  test("a sibling that finished the sequence ends it for the number", () => {
    const decision = claimDecision(req({}, { effectiveStep: NURTURE_STEPS.length }), NOW);
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /sequence is finished/);
  });

  test("a fresh duplicate cannot replay step 1 after a sibling sent it", () => {
    // Own counter says 0, so without the group figure this would send the
    // day-3 nudge to somebody who got it a fortnight ago.
    const decision = claimDecision(
      req({}, { effectiveStep: 1, effectiveLastNurtureAtMs: NOW - 14 * DAY }),
      NOW,
    );
    assert.equal(decision.claim, true);
    assert.equal(decision.step, 1, "step 2 of the sequence, not step 1 again");
    assert.equal(decision.kind, NURTURE_STEPS[1].kind);
  });

  test("a duplicate cannot text one day after its sibling did", () => {
    const decision = claimDecision(req({}, { effectiveLastNurtureAtMs: NOW - DAY }), NOW);
    assert.equal(decision.claim, false);
    assert.match(decision.reason, new RegExp(`minimum gap is ${MIN_GAP_DAYS}`));
  });

  test("the record's own progress still counts when it is the furthest along", () => {
    // The group figure is a floor, not a replacement — a stale grouping pass
    // must not walk a record backwards.
    const decision = claimDecision(
      req(
        {
          cas: { freshStep: 2, expectedStep: 2 },
          fresh: { nurtureStep: 2, lastNurtureAtMs: NOW - 20 * DAY },
        },
        { effectiveStep: 0, effectiveLastNurtureAtMs: null },
      ),
      NOW,
    );
    assert.equal(decision.claim, true);
    assert.equal(decision.step, 2);
  });

  test("with no siblings it behaves exactly as the lead's own record says", () => {
    const decision = claimDecision(req(), NOW);
    assert.equal(decision.claim, true);
    assert.equal(decision.step, 0);
  });
});

describe("what changed during the run is checked before the text goes out", () => {
  // A run reads the customer collection, then spends minutes: an opt-out
  // lookup and a transaction per lead, 1.1 seconds of pacing between sends,
  // up to ten of them. In those minutes a lead can reply, be quoted, be marked
  // do-not-knock, or have consent withdrawn. The claim used to re-check only
  // the counters, so all four still permitted a send. These tests are the
  // proof that each one now refuses — which is the level at which "Twilio is
  // never called" can actually be asserted, since the call sits behind this
  // returning a claim.
  const base = {
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    optedOut: false,
  };
  const claim = (freshPatch) =>
    claimDecision(
      {
        cas: {
          exists: true,
          freshStep: 0,
          freshLastNurtureAtMs: null,
          expectedStep: 0,
          expectedLastNurtureAtMs: null,
        },
        fresh: { ...base, ...freshPatch },
        group: { effectiveStep: 0, effectiveLastNurtureAtMs: null },
        shared: { step: 0, lastNurtureAtMs: null },
        phoneKeys: {
          expected: "5025550147",
          fresh: freshPatch.phone === "" ? "" : "5025550147",
        },
      },
      NOW,
    );

  test("unchanged, it claims", () => {
    // The control. Without this, every assertion below could pass for the
    // wrong reason.
    const decision = claim({});
    assert.equal(decision.claim, true);
    assert.equal(decision.step, 0);
  });

  test("a reply that landed during the run stops the text", () => {
    const decision = claim({ hasReplied: true });
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /replied/);
  });

  test("an opt-out that landed during the run stops the text", () => {
    const decision = claim({ optedOut: true });
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /STOP/);
  });

  test("an estimate accepted during the run stops the text", () => {
    // The one change here nobody on the crew has to make. A customer taps
    // Accept on their own share link at 9:01 and the run reaches them at 9:04;
    // without re-reading the estimate inside the claim, they get asked
    // whether they have thought about it.
    const decision = claim({ quoteStatus: "accepted" });
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /not open/);
  });

  test("an estimate declined during the run stops the text", () => {
    const decision = claim({ quoteStatus: "declined" });
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /not open/);
  });

  test("an estimate deleted during the run stops the text", () => {
    // Reads back as no estimate at all, which is the honest reading: the
    // reason for the message is gone.
    const decision = claim({ quoteStatus: "", quoteSentAtMs: 0 });
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /no estimate or quote/);
  });

  test("a customer moved on during the run stops the text", () => {
    const decision = claim({ pipelineStage: "estimate_accepted" });
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /moved on/);
  });

  test("a do-not-knock mark added during the run stops the text", () => {
    const decision = claim({ status: "do_not_knock" });
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /do not knock/);
  });

  test("consent withdrawn during the run stops the text", () => {
    const decision = claim({ consent: null });
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /no written or web-form consent/);
  });

  test("consent downgraded to a verbal yes stops the text", () => {
    // The shared SMS chokepoint would allow this one through — it guards job
    // confirmations too, where a verbal yes is enough. The marketing bar is
    // this function's job, and this test is why it cannot be moved.
    const decision = claim({ consent: { granted: true, method: "verbal" } });
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /need a web form or something written/);
  });

  test("a phone number cleared during the run stops the text", () => {
    // Caught by the number check now rather than the policy's own, because a
    // cleared number also means every per-number check this run did was about
    // a number this record no longer has.
    const decision = claim({ phone: "" });
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /no longer has a usable phone number/);
  });

  test("the compare-and-swap is still checked first", () => {
    // A changed field must not mask a lost race, or the reason reported for a
    // refusal would send somebody looking in the wrong place.
    const decision = claimDecision(
      {
        cas: {
          exists: true,
          freshStep: 1,
          freshLastNurtureAtMs: null,
          expectedStep: 0,
          expectedLastNurtureAtMs: null,
        },
        fresh: { ...base, hasReplied: true },
        group: { effectiveStep: 0, effectiveLastNurtureAtMs: null },
        shared: { step: 0, lastNurtureAtMs: null },
        phoneKeys: { expected: "5025550147", fresh: "5025550147" },
      },
      NOW,
    );
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /advanced this lead to step 1/);
  });
});

describe("the record chosen to send is one that can send", () => {
  // Confirmed by running it before fixing: given an older record with no
  // consent and a newer one from the same person who ticked the box on the
  // website, the old selection chose the unconsented record, was refused for
  // no consent, and did that again every night. The consented duplicate was
  // permanently shadowed and that lead was never nurtured at all — not a
  // message sent wrongly, but work quietly left on the table.
  const rec = (id, patch = {}) => ({
    id,
    phoneKey: "5025550147",
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    optedOut: false,
    eligible: true,
    // The grouping asks nurtureDecision which records would send, so a
    // fixture has to be a record the policy can actually judge. These
    // defaults are a lead that would send: a web-form consent, a phone
    // number, ten days old and never nurtured.
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    ...patch,
  });

  test("a consented duplicate is not shadowed by an unconsented one", () => {
    const { chosen } = oneLeadPerPhone([
      rec("older_no_consent", { consent: null }),
      rec("newer_web_form", { consent: { granted: true, method: "web_form" } }),
    ], NOW);
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].lead.id, "newer_web_form");
  });

  test("being able to send beats being further along", () => {
    // Deliberate, and safe because progress is computed across the group: the
    // chosen record is told the number's step, not its own.
    const { chosen } = oneLeadPerPhone([
      rec("ahead_no_consent", { nurtureStep: 2, consent: null }),
      rec("behind_consented", { nurtureStep: 0, consent: { granted: true, method: "web_form" } }),
    ], NOW);
    assert.equal(chosen[0].lead.id, "behind_consented");
    assert.equal(chosen[0].effectiveStep, 2, "the number has still had two messages");
  });

  test("among records that can all send, progress decides as before", () => {
    const { chosen } = oneLeadPerPhone([
      rec("behind", { nurtureStep: 0 }),
      rec("ahead", { nurtureStep: 2 }),
    ], NOW);
    assert.equal(chosen[0].lead.id, "ahead");
  });

  test("when none can send, one is still chosen so the reason is reported", () => {
    // Silence here would be worse than a refusal: nobody would know why a
    // lead was never contacted.
    const { chosen } = oneLeadPerPhone([rec("a", { consent: null })], NOW);
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].lead.id, "a");
  });

  test("recordIsSendable is the rule the grouping is sorting on", () => {
    const ok = { status: "active", phone: "+15025550147", consent: { granted: true, method: "web_form" } };
    assert.equal(recordIsSendable(ok), true);
    assert.equal(recordIsSendable({ ...ok, consent: { granted: true, method: "written" } }), true);
    assert.equal(recordIsSendable({ ...ok, consent: null }), false);
    assert.equal(recordIsSendable({ ...ok, consent: { granted: false, method: "web_form" } }), false);
    assert.equal(recordIsSendable({ ...ok, consent: { granted: true, method: "verbal" } }), false);
    assert.equal(recordIsSendable({ ...ok, phone: "   " }), false);
    assert.equal(recordIsSendable({ ...ok, status: "do_not_knock" }), false);
  });
});

describe("the claim belongs to the phone number, not the record", () => {
  // The third concurrency finding, and the one that finally named the real
  // shape of all of them: the compare-and-swap protected one customer
  // document, but the thing that must not happen twice belongs to a person.
  // Two overlapping runs can select two *different* records for one handset —
  // one record changing stage between the runs is enough — and two
  // independent documents gave two independent claims.
  const base = {
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    optedOut: false,
  };
  const req = (patch = {}) => ({
    cas: {
      exists: true,
      freshStep: 0,
      freshLastNurtureAtMs: null,
      expectedStep: 0,
      expectedLastNurtureAtMs: null,
      ...(patch.cas ?? {}),
    },
    fresh: { ...base, ...(patch.fresh ?? {}) },
    group: { effectiveStep: 0, effectiveLastNurtureAtMs: null, ...(patch.group ?? {}) },
    shared: { step: 0, lastNurtureAtMs: null, ...(patch.shared ?? {}) },
    phoneKeys: { expected: "5025550147", fresh: "5025550147", ...(patch.phoneKeys ?? {}) },
  });

  test("two runs on two different records for one number, only one sends", () => {
    // Each run holds its own customer record, so neither compare-and-swap can
    // see the other. The shared document is the only thing they have in
    // common, and Firestore putting it in both read sets is what makes the
    // second run retry and see the first one's stamp. Modelled here.
    let shared = { step: 0, lastNurtureAtMs: null };
    let sends = 0;
    for (const recordId of ["record_a", "record_b"]) {
      const decision = claimDecision(req({ shared: { ...shared } }), NOW);
      if (decision.claim) {
        shared = { step: decision.step + 1, lastNurtureAtMs: NOW };
        sends += 1;
      } else {
        assert.match(decision.reason, new RegExp(`minimum gap is ${MIN_GAP_DAYS}`), recordId);
      }
    }
    assert.equal(sends, 1, "one text to one person, not one per record");
  });

  test("the number's own record of its progress is authoritative", () => {
    // Everything else about this record says step 0 and nothing ever sent.
    const decision = claimDecision(
      req({ shared: { step: NURTURE_STEPS.length, lastNurtureAtMs: NOW - 60 * DAY } }),
      NOW,
    );
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /sequence is finished/);
  });

  test("the shared stamp holds a number back even on an untouched record", () => {
    const decision = claimDecision(req({ shared: { step: 0, lastNurtureAtMs: NOW - DAY } }), NOW);
    assert.equal(decision.claim, false);
    assert.match(decision.reason, new RegExp(`minimum gap is ${MIN_GAP_DAYS}`));
  });

  test("a first text to a number, with nothing recorded against it, claims", () => {
    const decision = claimDecision(req(), NOW);
    assert.equal(decision.claim, true);
    assert.equal(decision.step, 0);
    assert.equal(decision.phoneKey, "5025550147");
  });

  test("a phone number edited during the run is refused", () => {
    // Every per-number check this run did — the sibling reply, the sibling
    // opt-out, the shared progress — was about a number this record no longer
    // has, while the send would re-read the record and text the new one. A
    // number whose sibling said STOP could be reached that way.
    const decision = claimDecision(
      req({ fresh: { phone: "+15025559999" }, phoneKeys: { fresh: "5025559999" } }),
      NOW,
    );
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /phone number changed during the run/);
  });

  test("the claim names the number it authorised, so the send can be bound to it", () => {
    const decision = claimDecision(req(), NOW);
    assert.equal(decision.claim, true);
    assert.equal(
      decision.phoneKey,
      "5025550147",
      "the recipient is the number that was evaluated, not whatever is read later",
    );
  });
});

describe("do not knock is about the person, not the paperwork", () => {
  // "Leave them alone" is an instruction about a human being. Somebody who
  // gave it does not become contactable because a later form submission
  // created a second record without the mark.
  //
  // Preferring a record that can send — the fix for consent shadowing — made
  // this worse rather than better. Before it, the marked row sometimes won the
  // selection and was refused; after it, the clean duplicate was actively
  // chosen and texted. A fix in one direction opening a hole in the other is
  // the shape of this whole file's history, so this is pinned from both sides.
  const rec = (id, patch = {}) => ({
    id,
    phoneKey: "5025550147",
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    optedOut: false,
    eligible: true,
    // The grouping asks nurtureDecision which records would send, so a
    // fixture has to be a record the policy can actually judge. These
    // defaults are a lead that would send: a web-form consent, a phone
    // number, ten days old and never nurtured.
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    ...patch,
  });

  test("a marked record silences the number, even from a clean duplicate", () => {
    const { chosen, setAside } = oneLeadPerPhone([
      rec("marked", { status: "do_not_knock" }),
      rec("clean_consented"),
    ], NOW);
    assert.equal(chosen.length, 0, "this person asked not to be contacted");
    // Both are new leads somebody expected to be nurtured, so both get a
    // reason in the run's output rather than one vanishing.
    assert.deepEqual(setAside.map((s) => s.lead.id).sort(), ["clean_consented", "marked"]);
    for (const { reason } of setAside) assert.match(reason, /do not knock/);
  });

  test("an ineligible marked sibling silences it too", () => {
    // The mark is usually on the record somebody actually opened to set it,
    // and that is often the one that has moved past new_lead — the same
    // reason a reply hides on a record that moved on.
    const { chosen, setAside } = oneLeadPerPhone([
      rec("marked_and_quoted", {
        pipelineStage: "estimate_sent",
        status: "do_not_knock",
        eligible: false,
      }),
      rec("fresh_lead"),
    ], NOW);
    assert.equal(chosen.length, 0);
    assert.match(setAside[0].reason, /do not knock/);
  });

  test("being the only record does not make the mark negotiable", () => {
    const { chosen, setAside } = oneLeadPerPhone([rec("marked", { status: "do_not_knock" })], NOW);
    assert.equal(chosen.length, 0);
    assert.match(setAside[0].reason, /do not knock/);
  });

  test("a mark on one number does not silence a different number", () => {
    const { chosen } = oneLeadPerPhone([
      rec("marked", { status: "do_not_knock" }),
      rec("someone_else", { phoneKey: "5025559999" }),
    ], NOW);
    assert.deepEqual(chosen.map((c) => c.lead.id), ["someone_else"]);
  });

  test("an unmarked number is unaffected", () => {
    const { chosen } = oneLeadPerPhone([rec("a"), rec("b")], NOW);
    assert.equal(chosen.length, 1);
  });
});

describe("a released claim cannot erase somebody else's", () => {
  // The sequence the review named, which is an ordinary one rather than a
  // contrived race: a send fails, its claim is released, a note explaining the
  // failure is written — and when that note write throws, the catch releases
  // the same claim a second time. Between the two releases the number is
  // free, so an overlapping run can claim it, and a blind second release then
  // writes the old stamp back over that run's claim. A number with no recent
  // stamp is a number that gets texted again inside the gap.
  //
  // Two things stop it: a release happens at most once, and a release only
  // touches what its own stamp still owns. Both are modelled here because
  // either alone leaves a hole — the flag is in the route and the ownership
  // rule is this function.
  const FIRST = NOW;
  const SECOND = NOW + 1000;

  test("ownership is the claim's own stamp, nothing looser", () => {
    assert.equal(claimStillOwns(FIRST, FIRST), true);
    assert.equal(claimStillOwns(SECOND, FIRST), false, "another run's stamp is not ours to undo");
    assert.equal(claimStillOwns(null, FIRST), false, "already released by somebody");
    assert.equal(claimStillOwns(FIRST, null), false, "a claim with no receipt owns nothing");
    assert.equal(claimStillOwns(null, null), false);
  });

  test("failed send, release, another run claims, note write fails", () => {
    // A model of the shared document through the whole sequence. `release`
    // is the rule under test: restore only while this claim still owns what
    // is stored.
    let stored = null;
    const release = (claimStamp, previous) => {
      if (claimStillOwns(stored, claimStamp)) stored = previous;
    };

    // Run one claims, its send fails, it releases.
    stored = FIRST;
    release(FIRST, null);
    assert.equal(stored, null, "the release gave the number back");

    // An overlapping run claims the now-free number.
    stored = SECOND;

    // Run one's note write throws, and the catch tries to release again.
    release(FIRST, null);
    assert.equal(
      stored,
      SECOND,
      "the second release must not erase the other run's claim — a number with " +
        "no stamp is one that gets texted again inside the gap",
    );
  });

  test("a release still works when nothing has intervened", () => {
    // The guard must not make the ordinary case a no-op.
    let stored = FIRST;
    const release = (claimStamp, previous) => {
      if (claimStillOwns(stored, claimStamp)) stored = previous;
    };
    release(FIRST, null);
    assert.equal(stored, null);
  });

  test("a release restores the previous stamp, not merely null", () => {
    // A number on step 2 had a real stamp before this attempt. Releasing to
    // null would let it be texted immediately.
    const before = NOW - 20 * DAY;
    let stored = FIRST;
    const release = (claimStamp, previous) => {
      if (claimStillOwns(stored, claimStamp)) stored = previous;
    };
    release(FIRST, before);
    assert.equal(stored, before);
  });
});

describe("a stale duplicate cannot shadow a fresh one", () => {
  // The third version of this mistake, and the one that showed the mistake
  // was the method rather than the rule. Ranking by progress let an
  // unconsented record shadow a consented one; adding a consent-shaped flag
  // fixed that case and left the next proxy gap behind it. Two equally
  // consented step-0 records, one sixty days old and one four days old, were
  // separated by nothing but input order — and if the stale one won, it failed
  // the age guard every night while the fresh lead was never contacted at all.
  //
  // The selection asks nurtureDecision now, so there is no proxy left to be
  // wrong about.
  const rec = (id, patch = {}) => ({
    id,
    phoneKey: "5025550147",
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    optedOut: false,
    eligible: true,
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    ...patch,
  });

  test("the fresh lead is chosen even when the stale record is listed first", () => {
    const stale = rec("stale", { quoteSentAtMs: NOW - 60 * DAY });
    const fresh = rec("fresh", { quoteSentAtMs: NOW - 4 * DAY });
    const { chosen } = oneLeadPerPhone([stale, fresh], NOW);
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].lead.id, "fresh", "the stale record would fail the age guard nightly");
  });

  test("and when it is listed second", () => {
    // Input order must not decide anything.
    const { chosen } = oneLeadPerPhone(
      [rec("fresh", { quoteSentAtMs: NOW - 4 * DAY }), rec("stale", { quoteSentAtMs: NOW - 60 * DAY })],
      NOW,
    );
    assert.equal(chosen[0].lead.id, "fresh");
  });

  test("a record that is not yet due loses to one that is", () => {
    // Two fresh leads, one a day old. Day 3 has not arrived for it.
    const { chosen } = oneLeadPerPhone(
      [rec("yesterday", { quoteSentAtMs: NOW - DAY }), rec("last_week", { quoteSentAtMs: NOW - 7 * DAY })],
      NOW,
    );
    assert.equal(chosen[0].lead.id, "last_week");
  });

  test("when none would send, one is still chosen so the reason is reported", () => {
    const { chosen, setAside } = oneLeadPerPhone(
      [rec("a", { quoteSentAtMs: NOW - 60 * DAY }), rec("b", { quoteSentAtMs: NOW - 70 * DAY })],
      NOW,
    );
    assert.equal(chosen.length, 1, "silence would leave nobody knowing why");
    assert.equal(setAside.length, 1);
  });

  test("a consented fresh lead still beats an unconsented fresh one", () => {
    // The previous round's case, re-asserted through the new mechanism rather
    // than left to the old flag.
    const { chosen } = oneLeadPerPhone(
      [rec("no_consent", { consent: null }), rec("consented")],
      NOW,
    );
    assert.equal(chosen[0].lead.id, "consented");
  });

  test("the choice is still stable across two runs over the same data", () => {
    const leads = [rec("a"), rec("b"), rec("c")];
    const first = oneLeadPerPhone(leads, NOW).chosen[0].lead.id;
    const second = oneLeadPerPhone(leads, NOW).chosen[0].lead.id;
    assert.equal(first, second);
  });
});

describe("a text that reached Twilio but was never recorded holds the number", () => {
  // Twilio accepts the message, then both counter writes fail. The claim's
  // stamp holds the number for the minimum gap — and then, with the step
  // counter never advanced, the same message becomes due again. And again
  // every five days after that, for as long as nothing fixes it. For the last
  // message in the sequence that is a stranger receiving "I won't keep
  // texting you" every five days, indefinitely.
  //
  // So the claim writes a pending marker before Twilio is called, and only a
  // completed bookkeeping write clears it. While it is set the number is held
  // for a person to look at, because the honest reading of that state is that
  // a text may have gone out and the record of it may be wrong, and nobody
  // knows which.
  const base = {
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    optedOut: false,
  };
  const req = (shared = {}) => ({
    cas: {
      exists: true,
      freshStep: 0,
      freshLastNurtureAtMs: null,
      expectedStep: 0,
      expectedLastNurtureAtMs: null,
    },
    fresh: { ...base },
    group: { effectiveStep: 0, effectiveLastNurtureAtMs: null },
    shared: { step: 0, lastNurtureAtMs: null, pendingStep: null, ...shared },
    phoneKeys: { expected: "5025550147", fresh: "5025550147" },
  });

  test("nothing pending, and it claims as usual", () => {
    assert.equal(claimDecision(req(), NOW).claim, true);
  });

  test("a pending step holds the number, gap or no gap", () => {
    // The gap has long passed — this is exactly the moment the old code
    // resent the same message.
    const decision = claimDecision(
      req({ pendingStep: 0, lastNurtureAtMs: NOW - 30 * DAY }),
      NOW,
    );
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /never recorded/);
    assert.match(decision.reason, /held until somebody checks/);
  });

  test("the hold names the step so somebody knows what to look for", () => {
    const decision = claimDecision(req({ pendingStep: 2, lastNurtureAtMs: NOW - 30 * DAY }), NOW);
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /step 3 was sent to Twilio/);
  });

  test("a pending step of 0 is a hold, not a falsy nothing", () => {
    // The step is an index, so the first one is 0. Testing truthiness here
    // would release the hold on exactly the message most likely to be stuck.
    const decision = claimDecision(req({ pendingStep: 0 }), NOW);
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /never recorded/);
  });

  test("the hold outlasts the sequence being otherwise finished", () => {
    const decision = claimDecision(
      req({ pendingStep: 1, step: NURTURE_STEPS.length, lastNurtureAtMs: NOW - 90 * DAY }),
      NOW,
    );
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /never recorded/);
  });

  test("a lost race is still reported ahead of the hold", () => {
    // The compare-and-swap comes first, so the reason points at the race
    // rather than sending somebody to check a text that was never this run's.
    const decision = claimDecision(
      { ...req({ pendingStep: 0 }), cas: { ...req().cas, freshStep: 1 } },
      NOW,
    );
    assert.equal(decision.claim, false);
    assert.match(decision.reason, /advanced this lead to step 1/);
  });
});

describe("a send whose answer never came back", () => {
  // Two findings in one place, both consequences of distinguishing a Twilio
  // refusal from a lost answer in the first place. Three facts were being
  // carried in two booleans, and the gap between them was the bug twice over.
  const rejected = { ok: false, delivery: "rejected" };
  const lost = { ok: false, delivery: "unknown" };
  const accepted = { ok: true, delivery: "accepted" };

  test("each result maps to what is actually known", () => {
    assert.equal(sendStateFrom(accepted), "sent");
    assert.equal(sendStateFrom(rejected), "none", "Twilio answered and declined");
    assert.equal(sendStateFrom(lost), "unknown", "the request went out, the answer did not come");
  });

  test("a hold survives an exception after an uncertain send", () => {
    // The sequence: Twilio's answer is lost, so the claim is kept. Then the
    // note write throws. The old code read `texted === false` as
    // nothing-happened and released the hold, making a message that may have
    // arrived retryable five days later.
    const state = sendStateFrom(lost);
    assert.equal(mayRelease(state, false), false, "the hold must stand through the catch");
  });

  test("a confirmed non-send is still released, so it retries", () => {
    // The guard must not make every failure permanent.
    assert.equal(mayRelease(sendStateFrom(rejected), false), true);
  });

  test("a successful send is never released", () => {
    // Releasing here would let the same message go out again.
    assert.equal(mayRelease(sendStateFrom(accepted), false), false);
  });

  test("nothing is released twice", () => {
    assert.equal(mayRelease("none", true), false);
  });

  test("anything that may have reached a phone counts against the cap", () => {
    assert.equal(consumesCapacity("sent"), true);
    assert.equal(consumesCapacity("unknown"), true, "it may have arrived");
    assert.equal(consumesCapacity("none"), false, "nothing was sent, so nothing was spent");
  });

  test("a transport outage cannot walk the whole list", () => {
    // Every answer lost. Counting only confirmed successes meant the run
    // believed it had sent nothing and kept going — so an outage was the one
    // condition under which the safety cap did not apply at all.
    const CAP = 10;
    let spent = 0;
    let attempts = 0;
    for (let lead = 0; lead < 50; lead += 1) {
      if (spent >= CAP) break;
      attempts += 1;
      const state = sendStateFrom(lost);
      if (consumesCapacity(state)) spent += 1;
    }
    assert.equal(attempts, CAP, `an outage must still stop at ${CAP}, not run to 50`);
  });

  test("confirmed refusals do not eat the cap", () => {
    // The other direction: a run refused by Twilio for every lead has sent
    // nothing, so it has no reason to stop early.
    const CAP = 10;
    let spent = 0;
    let attempts = 0;
    for (let lead = 0; lead < 25; lead += 1) {
      if (spent >= CAP) break;
      attempts += 1;
      if (consumesCapacity(sendStateFrom(rejected))) spent += 1;
    }
    assert.equal(attempts, 25);
    assert.equal(spent, 0);
  });

  test("a mixed run counts the sent and the uncertain together", () => {
    const CAP = 10;
    let spent = 0;
    let attempts = 0;
    const results = [accepted, lost, rejected];
    for (let lead = 0; lead < 100; lead += 1) {
      if (spent >= CAP) break;
      attempts += 1;
      if (consumesCapacity(sendStateFrom(results[lead % 3]))) spent += 1;
    }
    assert.equal(spent, CAP);
    // Fourteen attempts: ten that may have arrived and four confirmed
    // refusals. Not fifteen — the tenth spend lands before that cycle's
    // refusal, so the loop stops a attempt early. Counted by hand and then
    // corrected against what it actually does.
    assert.equal(attempts, 14);
  });
});

describe("two businesses sharing one phone number", () => {
  // A landlord, a property manager or a spouse can be a customer of two
  // companies using this app. Grouping on the number alone meant one
  // business's reply, do-not-knock mark or nurture progress suppressed the
  // other's sequence — and the route's own org filter is what keeps the two
  // sets of records apart before they ever reach this function. These tests
  // are the other half of that: given only one org's records, as the route now
  // supplies, the grouping behaves exactly as it should.
  const rec = (id, patch = {}) => ({
    id,
    phoneKey: "5025550147",
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    optedOut: false,
    eligible: true,
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    ...patch,
  });

  test("our own lead still sends when only our records are supplied", () => {
    // The control: the filter upstream must not have broken the ordinary case.
    const { chosen } = oneLeadPerPhone([rec("ours")], NOW);
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].lead.id, "ours");
  });

  test("a reply only suppresses the records it was given with", () => {
    // Modelling what the route now passes: the foreign org's replied record is
    // simply not in the list. If it were, it would silence this number.
    const withForeign = oneLeadPerPhone([rec("theirs_replied", { hasReplied: true }), rec("ours")], NOW);
    assert.equal(withForeign.chosen.length, 0, "a replied record in the group silences it");

    const scoped = oneLeadPerPhone([rec("ours")], NOW);
    assert.equal(scoped.chosen.length, 1, "scoped to one org, the reply is not ours to act on");
  });

  test("a do-not-knock mark likewise", () => {
    const withForeign = oneLeadPerPhone(
      [rec("theirs_blocked", { status: "do_not_knock" }), rec("ours")],
      NOW,
    );
    assert.equal(withForeign.chosen.length, 0);
    assert.equal(oneLeadPerPhone([rec("ours")], NOW).chosen.length, 1);
  });

  test("and progress", () => {
    // Their sequence being finished must not finish ours.
    const withForeign = oneLeadPerPhone(
      [rec("theirs_done", { nurtureStep: NURTURE_STEPS.length }), rec("ours")],
      NOW,
    );
    assert.equal(withForeign.chosen[0].effectiveStep, NURTURE_STEPS.length);

    const scoped = oneLeadPerPhone([rec("ours")], NOW);
    assert.equal(scoped.chosen[0].effectiveStep, 0, "our sequence starts at the beginning");
  });
});

describe("whose STOP it was", () => {
  // The behavioural half: given the records of one org, a STOP in that org
  // stops the sequence and a STOP outside it is not in the set at all. The
  // route supplies the scoping; this is what the policy then does with it.
  const rec = (id, patch = {}) => ({
    id,
    phoneKey: "5025550147",
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    optedOut: false,
    eligible: true,
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    ...patch,
  });

  test("our own STOP stops our sequence", () => {
    const { chosen, setAside } = oneLeadPerPhone([rec("ours", { optedOut: true })], NOW);
    assert.equal(chosen.length, 0);
    assert.match(setAside[0].reason, /STOP/);
  });

  test("a STOP on a sibling record of ours stops it too", () => {
    const { chosen } = oneLeadPerPhone(
      [rec("ours_old", { optedOut: true, eligible: false }), rec("ours_new")],
      NOW,
    );
    assert.equal(chosen.length, 0, "one STOP in this business is enough");
  });

  test("a consented lead sends when no STOP of ours exists", () => {
    // What the unscoped lookup used to prevent, permanently: the only STOP on
    // this number belonged to another company, so it was never ours to act on
    // and is not in this set.
    const { chosen } = oneLeadPerPhone([rec("ours")], NOW);
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].lead.id, "ours");
  });

  test("a STOP is not retracted by a later record without one", () => {
    // The direction that must not loosen while fixing the one that was too
    // tight: a second form submission is not a change of mind.
    const { chosen } = oneLeadPerPhone(
      [rec("said_stop", { optedOut: true }), rec("fresh_form")],
      NOW,
    );
    assert.equal(chosen.length, 0);
  });
});

describe("a number that has already decided", () => {
  // nurtureDecision refuses a record that has accepted, been scheduled, paid
  // or been written off: the decision has been made and a cron does not get to
  // reopen it. But it is only ever asked of the record about to send — so
  // without the group-wide check, a customer who accepted one estimate on
  // Monday gets chased about an older open one on Tuesday, because the
  // acceptance is recorded on a different row of the same person.
  const rec = (id, patch = {}) => ({
    id,
    phoneKey: "5025550147",
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    optedOut: false,
    eligible: true,
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    ...patch,
  });

  test("an accepted duplicate stops the fresh one", () => {
    const { chosen, setAside } = oneLeadPerPhone(
      [rec("accepted", { pipelineStage: "estimate_accepted", eligible: false }), rec("fresh")],
      NOW,
    );
    assert.equal(chosen.length, 0, "this person has already said yes");
    assert.match(setAside[0].reason, /accepted, was won, or was written off/);
  });

  test("a won customer is not somebody to chase for a decision", () => {
    for (const stage of ["job_scheduled", "awaiting_payment", "paid"]) {
      const { chosen } = oneLeadPerPhone(
        [rec("won", { pipelineStage: stage, eligible: false }), rec("fresh")],
        NOW,
      );
      assert.equal(chosen.length, 0, stage);
    }
  });

  test("a lost one either", () => {
    const { chosen } = oneLeadPerPhone(
      [rec("lost", { pipelineStage: "lost", eligible: false }), rec("fresh")],
      NOW,
    );
    assert.equal(chosen.length, 0);
  });

  test("a number whose records are all still awaiting a decision is unaffected", () => {
    const { chosen } = oneLeadPerPhone([rec("a"), rec("b")], NOW);
    assert.equal(chosen.length, 1);
  });

  test("a different number is unaffected by somebody else's acceptance", () => {
    const { chosen } = oneLeadPerPhone(
      [
        rec("accepted", { pipelineStage: "estimate_accepted", eligible: false }),
        rec("someone_else", { phoneKey: "5025559999" }),
      ],
      NOW,
    );
    assert.deepEqual(chosen.map((c) => c.lead.id), ["someone_else"]);
  });
});

describe("no texts means no texts, on any of this person's records", () => {
  // The edge left behind by the fix that let a consented record beat an
  // unconsented one. Absent consent and refused consent are not the same
  // thing: the first is silence, the second is something the person did. A
  // refusal recorded today was losing to a grant from a form filled in last
  // spring, so ticking "no texts" left marketing switched on.
  const rec = (id, patch = {}) => ({
    id,
    phoneKey: "5025550147",
    nurtureStep: 0,
    lastNurtureAtMs: null,
    hasReplied: false,
    optedOut: false,
    eligible: true,
    pipelineStage: "estimate_sent",
  quoteStatus: "sent",
    status: "active",
    quoteSentAtMs: NOW - 10 * DAY,
    phone: "+15025550147",
    consent: { granted: true, method: "web_form" },
    ...patch,
  });

  test("a refusal on one record blocks an otherwise eligible duplicate", () => {
    const { chosen, setAside } = oneLeadPerPhone(
      [
        rec("said_no", { consent: { granted: false, method: "web_form" } }),
        rec("older_yes", { consent: { granted: true, method: "web_form" } }),
      ],
      NOW,
    );
    assert.equal(chosen.length, 0, "the person said no; the older yes does not outvote it");
    for (const { reason } of setAside) assert.match(reason, /no texts/);
  });

  test("a refusal on a record that has moved on still counts", () => {
    const { chosen } = oneLeadPerPhone(
      [
        rec("said_no", { consent: { granted: false, method: "written" }, eligible: false }),
        rec("fresh"),
      ],
      NOW,
    );
    assert.equal(chosen.length, 0);
  });

  test("absent consent is not a refusal", () => {
    // Still not sendable on its own — nurtureDecision refuses it — but it must
    // not silence a sibling who did consent, which was the round-eight fix and
    // has to keep working.
    const { chosen } = oneLeadPerPhone(
      [rec("no_record", { consent: null }), rec("consented")],
      NOW,
    );
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].lead.id, "consented");
  });

  test("a verbal yes is not a refusal either", () => {
    // Too thin for marketing, which nurtureDecision enforces, but not a no.
    const { chosen } = oneLeadPerPhone(
      [rec("verbal", { consent: { granted: true, method: "verbal" } }), rec("web_form")],
      NOW,
    );
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].lead.id, "web_form");
  });

  test("a refusal on one number does not silence another", () => {
    const { chosen } = oneLeadPerPhone(
      [
        rec("said_no", { consent: { granted: false, method: "web_form" } }),
        rec("someone_else", { phoneKey: "5025559999" }),
      ],
      NOW,
    );
    assert.deepEqual(chosen.map((c) => c.lead.id), ["someone_else"]);
  });
});

describe("which estimate the sequence is about", () => {
  // The route hands this every estimate a customer has, closed ones included,
  // because deciding needs them. Every case below is a text that would have
  // gone out wrongly without it.
  const q = (patch = {}) => ({
    id: "q1",
    customerId: "cust",
    status: "sent",
    sentAtMs: NOW - 10 * DAY,
    convertedToId: null,
    ...patch,
  });

  test("nothing at all is nothing to chase", () => {
    assert.equal(pickOpenQuote([]), null);
  });

  test("one open estimate is the one", () => {
    assert.equal(pickOpenQuote([q()]).id, "q1");
  });

  test("the newer of two open estimates wins", () => {
    // One person, one decision — about the newer price. Chasing both is two
    // texts about two numbers for the same work.
    const picked = pickOpenQuote([
      q({ id: "may", sentAtMs: NOW - 40 * DAY }),
      q({ id: "june", sentAtMs: NOW - 4 * DAY }),
    ]);
    assert.equal(picked.id, "june");
  });

  test("an accepted newer estimate closes the whole customer out", () => {
    // The bug the first version of the query had. Asking only for the open
    // estimates returns the May one on its own, and the run chases somebody
    // about a price while the June one they accepted is already scheduled.
    const picked = pickOpenQuote([
      q({ id: "may", sentAtMs: NOW - 40 * DAY, status: "sent" }),
      q({ id: "june", sentAtMs: NOW - 4 * DAY, status: "accepted" }),
    ]);
    assert.equal(picked, null, "they accepted the newer one — there is nothing to chase");
  });

  test("a declined newer estimate closes them out too", () => {
    const picked = pickOpenQuote([
      q({ id: "may", sentAtMs: NOW - 40 * DAY }),
      q({ id: "june", sentAtMs: NOW - 4 * DAY, status: "declined" }),
    ]);
    assert.equal(picked, null);
  });

  test("every closed status closes them out", () => {
    for (const status of ["accepted", "declined", "void", "partial", "paid", "draft"]) {
      assert.equal(pickOpenQuote([q({ status })]), null, status);
    }
  });

  test("an estimate turned into an invoice is closed whatever its status says", () => {
    // Converting is acceptance in all but name, and the status field is not
    // always the record of it.
    assert.equal(pickOpenQuote([q({ status: "sent", convertedToId: "inv_9" })]), null);
  });

  test("an estimate with no sent date is not an anchor", () => {
    // And does not shadow a real one: there is no day 3 without a day 0.
    assert.equal(pickOpenQuote([q({ sentAtMs: 0 })]), null);
    assert.equal(pickOpenQuote([q({ id: "undated", sentAtMs: 0 }), q({ id: "real" })]).id, "real");
  });

  test("a legacy quote marked unanswered by hand is open", () => {
    assert.equal(pickOpenQuote([q({ status: "no_response" })]).id, "q1");
  });
});
