/**
 * The engine that decides whether an automation texts somebody.
 *
 * This is the only code in the app where a non-programmer composes the rule
 * AND the recipient list, so the tests are weighted towards the refusals
 * rather than the happy path. A send that should not have happened cannot be
 * recalled; one that should have and did not is a text sent a day late.
 *
 * The three ceilings worth the most attention are the ones lib/leadNurture.ts
 * learned the hard way, and each has its own case below:
 *
 *   staleAfterDays, because on the day an automation is armed every record
 *   that has ever matched its trigger matches at once;
 *   minGapDays, because step days measured from an anchor all come due
 *   together on an old record;
 *   maxPerRun, because a wrong date calculation should cost a handful of
 *   texts rather than the customer list.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  ACTION_LABEL,
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  actionLeavesTheBuilding,
  clampGuards,
  clockFrom,
  decide,
  defaultConditions,
  defaultGuards,
  describeAutomation,
  matchesConditions,
  MAX_PER_RUN_CEILING,
  MAX_WINDOW_DAYS,
  MAX_TOUCHES_CEILING,
  MIN_GAP_DAYS_FLOOR,
  renderTemplate,
  SEND_HOUR_CEILING,
  SEND_HOUR_FLOOR,
  segmentsFor,
  TEMPLATE_FIELDS,
  TRIGGER_ANCHOR_LABEL,
  TRIGGER_LABEL,
  unknownTokens,
  validateAutomation,
} from "../lib/automations.ts";
import { BUILTIN_AUTOMATIONS, builtinByDocId, builtinEnabled, builtinOrder } from "../lib/automationBuiltins.ts";

const DAY = 86_400_000;
const NOW = new Date("2026-10-12T15:00:00Z");

/** A clock inside every default window: a Monday, 11am Eastern. */
function clock(at = NOW) {
  return clockFrom(at);
}

function subject(overrides = {}) {
  return {
    customerId: "c1",
    firstName: "Marta",
    phone: "502-555-0101",
    address: "12 Oak St, Crestwood KY",
    propertyType: "residential",
    stage: "estimate_sent",
    serviceType: "pressure_washing",
    anchorAt: new Date(NOW.getTime() - 10 * DAY).toISOString(),
    amount: 450,
    touches: 0,
    lastTouchAt: null,
    repliedSince: false,
    ...overrides,
  };
}

function automation(overrides = {}) {
  return {
    enabled: true,
    conditions: defaultConditions(),
    action: { kind: "send_sms", body: "Hi {first_name}", stage: null },
    guards: clampGuards({ ...defaultGuards(), afterDays: 3, staleAfterDays: 60 }),
    ...overrides,
  };
}

describe("the ceilings cannot be exceeded by anything a form can submit", () => {
  test("absurd numbers are pulled back to the limits", () => {
    const g = clampGuards({
      afterDays: 99_999,
      maxTouches: 400,
      minGapDays: 0,
      maxPerRun: 100_000,
      staleAfterDays: 10_000,
      startHour: 2,
      endHour: 23,
      repeatEveryDays: 1,
      daysOfWeek: [0, 1, 99, -3, 1],
    });

    assert.equal(g.afterDays, 365);
    assert.equal(g.maxTouches, MAX_TOUCHES_CEILING);
    assert.equal(g.minGapDays, MIN_GAP_DAYS_FLOOR);
    assert.equal(g.maxPerRun, MAX_PER_RUN_CEILING);
    // Relative to the wait, so the cap bounds the WIDTH of the net.
    assert.equal(g.staleAfterDays, g.afterDays + MAX_WINDOW_DAYS);
    assert.ok(g.startHour >= SEND_HOUR_FLOOR, `startHour ${g.startHour}`);
    assert.ok(g.endHour <= SEND_HOUR_CEILING, `endHour ${g.endHour}`);
    // A repeat tighter than the minimum gap would make the gap decorative.
    assert.ok(g.repeatEveryDays >= g.minGapDays, `repeat ${g.repeatEveryDays}`);
    assert.deepEqual(g.daysOfWeek, [0, 1], "out-of-range and duplicate days dropped");
  });

  test("nonsense and missing values fall back rather than becoming NaN", () => {
    const g = clampGuards({ afterDays: "soon", maxPerRun: null, minGapDays: undefined });
    assert.ok(Number.isInteger(g.afterDays), `afterDays ${g.afterDays}`);
    assert.ok(Number.isInteger(g.maxPerRun), `maxPerRun ${g.maxPerRun}`);
    assert.ok(Number.isInteger(g.minGapDays), `minGapDays ${g.minGapDays}`);
    // Total, not validating: it has to return something usable even for null,
    // because it runs on the way OUT of the database too — and an automation
    // that cannot be read is an automation that cannot be switched off.
    assert.ok(Number.isInteger(clampGuards(null).afterDays));
  });

  test("the staleness cap always leaves room for the trigger to fire", () => {
    // An automation that waits 14 days and ignores anything over 7 can never
    // send, and on screen that is indistinguishable from one that is armed and
    // simply has nothing to do today.
    const g = clampGuards({ afterDays: 14, staleAfterDays: 7 });
    assert.ok(g.staleAfterDays > g.afterDays, `${g.staleAfterDays} vs ${g.afterDays}`);
  });

  test("the end of the sending window is always after its start", () => {
    const g = clampGuards({ startHour: 18, endHour: 9 });
    assert.ok(g.endHour > g.startHour, `${g.startHour}–${g.endHour}`);
  });

  test("a brand-new automation's defaults are themselves inside the ceilings", () => {
    assert.deepEqual(clampGuards(defaultGuards()), defaultGuards());
  });
});

describe("the refusal ladder", () => {
  test("a reply stops it before any other consideration", () => {
    // Checked first on purpose: somebody who has answered must not be
    // reconsidered on any other ground, including a later edit that widens
    // the automation's reach.
    const d = decide(automation(), subject({ repliedSince: true }), clock());
    assert.equal(d.send, false);
    assert.match(d.reason, /replied/i);
  });

  test("a switched-off automation does nothing", () => {
    const d = decide(automation({ enabled: false }), subject(), clock());
    assert.equal(d.send, false);
    assert.match(d.reason, /off/i);
  });

  test("no phone number stops a text but not a note", () => {
    const noPhone = subject({ phone: null });
    assert.equal(decide(automation(), noPhone, clock()).send, false);

    const note = automation({ action: { kind: "add_note", body: "x", stage: null } });
    assert.equal(decide(note, noPhone, clock()).send, true, "a note needs no phone");
  });

  test("an anchor in the future is refused", () => {
    const future = subject({ anchorAt: new Date(NOW.getTime() + 5 * DAY).toISOString() });
    const d = decide(automation(), future, clock());
    assert.equal(d.send, false);
    assert.match(d.reason, /future/i);
  });

  test("a missing or unreadable anchor is refused, with different reasons", () => {
    assert.match(decide(automation(), subject({ anchorAt: null }), clock()).reason, /measure/i);
    assert.match(
      decide(automation(), subject({ anchorAt: "not a date" }), clock()).reason,
      /cannot be read/i,
    );
  });

  test("not yet due says how many days are left, not just 'no'", () => {
    // "Not due" is useless in a list of two hundred; "due in 4 days" tells
    // somebody whether to wait.
    const young = subject({ anchorAt: new Date(NOW.getTime() - 1 * DAY).toISOString() });
    const d = decide(automation({ guards: clampGuards({ afterDays: 5 }) }), young, clock());
    assert.equal(d.send, false);
    assert.equal(d.reason, "Due in 4 days");
  });

  test("one day left is singular", () => {
    const young = subject({ anchorAt: new Date(NOW.getTime() - 4 * DAY).toISOString() });
    const d = decide(automation({ guards: clampGuards({ afterDays: 5 }) }), young, clock());
    assert.equal(d.reason, "Due in 1 day");
  });

  test("an anchor older than the staleness cap is left alone", () => {
    // THE case. The day an automation is armed, a two-year-old estimate
    // satisfies "14 days after the estimate was sent" exactly as well as
    // yesterday's does.
    const ancient = subject({ anchorAt: new Date(NOW.getTime() - 700 * DAY).toISOString() });
    const d = decide(automation(), ancient, clock());
    assert.equal(d.send, false);
    assert.match(d.reason, /too old/i);
  });

  test("the cap is inclusive at its edge and refuses one day past it", () => {
    const guards = clampGuards({ afterDays: 3, staleAfterDays: 30 });
    const at30 = subject({ anchorAt: new Date(NOW.getTime() - 30 * DAY).toISOString() });
    const at31 = subject({ anchorAt: new Date(NOW.getTime() - 31 * DAY).toISOString() });
    assert.equal(decide(automation({ guards }), at30, clock()).send, true, "30 days is in");
    assert.equal(decide(automation({ guards }), at31, clock()).send, false, "31 days is out");
  });

  test("a once-only automation does not send twice", () => {
    const guards = clampGuards({ afterDays: 3, staleAfterDays: 60, repeatEveryDays: null });
    const d = decide(
      automation({ guards }),
      subject({ touches: 1, lastTouchAt: new Date(NOW.getTime() - 40 * DAY).toISOString() }),
      clock(),
    );
    assert.equal(d.send, false);
    assert.match(d.reason, /only sends once/i);
  });

  test("the per-person total is honoured", () => {
    const guards = clampGuards({
      afterDays: 3,
      staleAfterDays: 90,
      repeatEveryDays: 7,
      maxTouches: 2,
    });
    const d = decide(
      automation({ guards }),
      subject({ touches: 2, lastTouchAt: new Date(NOW.getTime() - 30 * DAY).toISOString() }),
      clock(),
    );
    assert.equal(d.send, false);
    assert.match(d.reason, /already had 2 of 2/i);
  });

  test("the minimum gap wins even when the repeat interval has elapsed", () => {
    // clampGuards already refuses to store a repeat below the gap. This is the
    // second line: a document written before the floor existed, or edited by
    // hand, still cannot text somebody two days running.
    const guards = { ...clampGuards({ afterDays: 1, staleAfterDays: 90, maxTouches: 3 }) };
    guards.repeatEveryDays = 1;
    guards.minGapDays = 5;
    const d = decide(
      automation({ guards }),
      subject({ touches: 1, lastTouchAt: new Date(NOW.getTime() - 2 * DAY).toISOString() }),
      clock(),
    );
    assert.equal(d.send, false);
    assert.match(d.reason, /waiting 3 more/i);
  });

  test("a counted touch with no date is refused rather than treated as long ago", () => {
    const guards = clampGuards({ afterDays: 3, staleAfterDays: 90, repeatEveryDays: 7, maxTouches: 3 });
    const d = decide(automation({ guards }), subject({ touches: 1, lastTouchAt: null }), clock());
    assert.equal(d.send, false, "refusing is the safe direction");
    assert.match(d.reason, /date of it is missing/i);
  });

  test("a day of the week not chosen is refused", () => {
    // 2026-10-12 is a Monday. Allowing only Sunday must refuse it.
    const guards = clampGuards({ afterDays: 3, staleAfterDays: 60, daysOfWeek: [0] });
    const d = decide(automation({ guards }), subject(), clock());
    assert.equal(d.send, false);
    assert.match(d.reason, /sending days/i);
    assert.equal(clock().localDay, 1, "the fixture really is a Monday locally");
  });

  test("outside the sending hours is refused, and the window is reported", () => {
    // 15:00 UTC is 11:00 Eastern in October.
    const guards = clampGuards({ afterDays: 3, staleAfterDays: 60, startHour: 13, endHour: 17 });
    const d = decide(automation({ guards }), subject(), clock());
    assert.equal(d.send, false);
    assert.match(d.reason, /13:00/);
  });

  test("and inside them, it sends with no reason given", () => {
    const d = decide(automation(), subject(), clock());
    assert.equal(d.send, true);
    assert.equal(d.reason, "", "an allowed send carries no explanation");
  });

  test("every refusal explains itself", () => {
    // A blank reason reaches the preview as an empty table cell, which reads
    // as a bug in the screen rather than a decision by the engine.
    const cases = [
      [automation({ enabled: false }), subject()],
      [automation(), subject({ repliedSince: true })],
      [automation(), subject({ phone: null })],
      [automation(), subject({ anchorAt: null })],
      [automation(), subject({ anchorAt: "nope" })],
      [automation(), subject({ anchorAt: new Date(NOW.getTime() + DAY).toISOString() })],
      [automation(), subject({ anchorAt: new Date(NOW.getTime() - 900 * DAY).toISOString() })],
      [automation({ guards: clampGuards({ afterDays: 90 }) }), subject()],
    ];
    for (const [a, s] of cases) {
      const d = decide(a, s, clock());
      assert.equal(d.send, false);
      assert.ok(d.reason.length > 5, `empty-ish reason: ${JSON.stringify(d.reason)}`);
    }
  });
});

describe("who it reaches", () => {
  test("an empty filter means everybody the trigger found", () => {
    assert.equal(matchesConditions(subject(), defaultConditions()), true);
  });

  test("amount bounds are inclusive, and a record with no amount fails a bound", () => {
    const within = { ...defaultConditions(), minAmount: 450, maxAmount: 450 };
    assert.equal(matchesConditions(subject({ amount: 450 }), within), true);
    assert.equal(matchesConditions(subject({ amount: 449 }), within), false);
    assert.equal(
      matchesConditions(subject({ amount: null }), within),
      false,
      "unknown money cannot satisfy a money filter",
    );
  });

  test("a list filter excludes anything not on it, including an unknown value", () => {
    const snow = { ...defaultConditions(), serviceTypes: ["snow_removal"] };
    assert.equal(matchesConditions(subject({ serviceType: "snow_removal" }), snow), true);
    assert.equal(matchesConditions(subject({ serviceType: "pressure_washing" }), snow), false);
    assert.equal(matchesConditions(subject({ serviceType: null }), snow), false);
  });

  test("the address filter is a case-insensitive substring", () => {
    const crestwood = { ...defaultConditions(), addressContains: ["crestWOOD"] };
    assert.equal(matchesConditions(subject(), crestwood), true);
    assert.equal(matchesConditions(subject({ address: "9 Elm, Louisville" }), crestwood), false);
    assert.equal(matchesConditions(subject({ address: null }), crestwood), false);
  });

  test("a blank entry in the address filter matches nobody, not everybody", () => {
    // A stray empty row in the builder would otherwise widen the automation to
    // the whole list — silently, and in the direction that costs money.
    const blank = { ...defaultConditions(), addressContains: ["   "] };
    assert.equal(matchesConditions(subject(), blank), false);
  });

  test("filters combine as AND", () => {
    const both = {
      ...defaultConditions(),
      stages: ["estimate_sent"],
      propertyTypes: ["commercial"],
    };
    assert.equal(matchesConditions(subject(), both), false, "right stage, wrong property type");
  });
});

describe("the message", () => {
  test("known fields are filled", () => {
    assert.equal(
      renderTemplate("Hi {first_name}, {business} here", {
        first_name: "Marta",
        business: "Grime Busters",
      }),
      "Hi Marta, Grime Busters here",
    );
  });

  test("a known field with nothing to put in it renders as nothing", () => {
    assert.equal(renderTemplate("Hi {first_name}!", {}), "Hi !");
  });

  test("an unknown token is left exactly as typed", () => {
    // Blanking it would hide the typo until a customer read the result; left
    // in place, the preview shows it and the owner can see the mistake.
    assert.equal(renderTemplate("Hi {nickname}", { first_name: "Marta" }), "Hi {nickname}");
    assert.deepEqual(unknownTokens("Hi {nickname} and {first_name}"), ["nickname"]);
    assert.deepEqual(unknownTokens("Hi {first_name}"), []);
  });

  test("every documented merge field is actually fillable", () => {
    // A field offered by a chip in the builder that the renderer does not know
    // would insert a token that sends literally.
    for (const field of TEMPLATE_FIELDS) {
      const out = renderTemplate(`[{${field.token}}]`, { [field.token]: "X" });
      assert.equal(out, "[X]", field.token);
    }
  });

  test("segments are counted the way a phone bill counts them", () => {
    assert.equal(segmentsFor(""), 0);
    assert.equal(segmentsFor("a".repeat(160)), 1);
    assert.equal(segmentsFor("a".repeat(161)), 2, "161 is two, not one");
  });
});

describe("what the builder refuses to save", () => {
  const draft = (overrides = {}) => ({
    name: "Leaf season",
    trigger: "job_finished",
    conditions: defaultConditions(),
    action: { kind: "send_sms", body: "Hi {first_name}", stage: null },
    guards: defaultGuards(),
    ...overrides,
  });

  test("a complete draft has nothing wrong with it", () => {
    assert.deepEqual(validateAutomation(draft()), []);
  });

  test("an unnamed one is refused", () => {
    assert.ok(validateAutomation(draft({ name: "x" })).length > 0);
  });

  test("an empty message is refused for a text and for a note", () => {
    assert.ok(
      validateAutomation(draft({ action: { kind: "send_sms", body: "  ", stage: null } })).length >
        0,
    );
    assert.ok(
      validateAutomation(draft({ action: { kind: "add_note", body: "", stage: null } })).length > 0,
    );
  });

  test("a move with nowhere to move to is refused", () => {
    const problems = validateAutomation(
      draft({ action: { kind: "move_stage", body: "", stage: null } }),
    );
    assert.ok(problems.some((p) => /stage/i.test(p)), problems.join(" | "));
  });

  test("a stray token is reported rather than silently sent", () => {
    const problems = validateAutomation(
      draft({ action: { kind: "send_sms", body: "Hi {nickname}", stage: null } }),
    );
    assert.ok(problems.some((p) => p.includes("{nickname}")), problems.join(" | "));
  });

  test("backwards amount bounds are reported", () => {
    const problems = validateAutomation(
      draft({ conditions: { ...defaultConditions(), minAmount: 900, maxAmount: 100 } }),
    );
    assert.ok(problems.some((p) => /larger/i.test(p)), problems.join(" | "));
  });

  test("a four-message-long text is refused", () => {
    const problems = validateAutomation(
      draft({ action: { kind: "send_sms", body: "x".repeat(500), stage: null } }),
    );
    assert.ok(problems.some((p) => /shorten/i.test(p)), problems.join(" | "));
  });
});

describe("the clock", () => {
  test("daylight saving is followed rather than assumed", () => {
    // A fixed offset would drift an hour twice a year and start texting people
    // at seven in the morning every November.
    const summer = clockFrom(new Date("2026-07-01T15:00:00Z"));
    const winter = clockFrom(new Date("2026-12-01T15:00:00Z"));
    assert.equal(summer.localHour, 11, "EDT is UTC-4");
    assert.equal(winter.localHour, 10, "EST is UTC-5");
  });

  test("weekdays come back as 0-6 with Sunday first", () => {
    assert.equal(clockFrom(new Date("2026-10-11T16:00:00Z")).localDay, 0, "Sunday");
    assert.equal(clockFrom(new Date("2026-10-17T16:00:00Z")).localDay, 6, "Saturday");
  });

  test("midnight local is hour 0, not 24", () => {
    // hour12:false renders midnight as "24" in some ICU builds, and 24 would
    // sit outside every window for ever.
    const h = clockFrom(new Date("2026-10-12T04:30:00Z")).localHour;
    assert.ok(h >= 0 && h <= 23, `hour ${h}`);
  });
});

describe("the labels the screen depends on", () => {
  test("every trigger and action has wording", () => {
    for (const trigger of AUTOMATION_TRIGGERS) {
      assert.ok(TRIGGER_LABEL[trigger]?.length > 0, trigger);
      assert.ok(TRIGGER_ANCHOR_LABEL[trigger]?.length > 0, trigger);
    }
    for (const action of AUTOMATION_ACTIONS) {
      assert.ok(ACTION_LABEL[action]?.length > 0, action);
    }
  });

  test("only texting leaves the building", () => {
    assert.equal(actionLeavesTheBuilding("send_sms"), true);
    for (const action of AUTOMATION_ACTIONS.filter((a) => a !== "send_sms")) {
      assert.equal(actionLeavesTheBuilding(action), false, action);
    }
  });

  test("the one-line description names the action, the wait and the repeat", () => {
    const line = describeAutomation({
      trigger: "estimate_unanswered",
      action: { kind: "send_sms", body: "", stage: null },
      guards: clampGuards({ afterDays: 7, repeatEveryDays: 14, maxTouches: 3 }),
    });
    assert.match(line, /Text the customer/);
    assert.match(line, /7 days after/);
    assert.match(line, /3×/);
  });
});

describe("the built-in sequences", () => {
  test("a missing row means on", () => {
    // Both were written to run and vercel.json has been asking for them daily.
    // An absent document is an upgrade that has not been through the screen
    // yet, not a decision to stop.
    assert.equal(builtinEnabled(undefined), true);
    assert.equal(builtinEnabled(null), true);
  });

  test("only an explicit false switches one off", () => {
    assert.equal(builtinEnabled({ enabled: false }), false);
    assert.equal(builtinEnabled({ enabled: true }), true);
  });

  test("each one is findable by the document id the cron uses", () => {
    for (const builtin of BUILTIN_AUTOMATIONS) {
      assert.equal(builtinByDocId(builtin.docId)?.key, builtin.key);
      assert.ok(builtin.docId.startsWith("builtin_"), builtin.docId);
      assert.ok(builtin.what.length > 40, `${builtin.key} needs a real description`);
      assert.ok(builtin.when.length > 0, builtin.key);
    }
  });

  test("the list has a stable order, and unknown keys sort last", () => {
    assert.equal(builtinOrder("lead_nurture"), 0);
    assert.ok(builtinOrder("made_up") >= BUILTIN_AUTOMATIONS.length);
  });

  test("the one that texts customers is marked as such", () => {
    // The screen warns differently for the two, and getting this backwards
    // would under-warn about the only one that can reach a stranger.
    const nurture = BUILTIN_AUTOMATIONS.find((b) => b.key === "lead_nurture");
    const money = BUILTIN_AUTOMATIONS.find((b) => b.key === "money_reminders");
    assert.equal(nurture.textsCustomers, true);
    assert.equal(money.textsCustomers, false);
  });
});
