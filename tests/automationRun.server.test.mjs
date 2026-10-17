/**
 * What the automation runner actually does to the database.
 *
 * The pure engine is covered by tests/automations.test.mjs, which can prove
 * every refusal by calling `decide`. This file covers the half that cannot be
 * tested that way: the send ledger, and therefore whether an automation that
 * has already acted on somebody acts on them again tomorrow.
 *
 * That distinction is not academic. The first version of `runAutomation`
 * claimed a touch only for the text action, on the reasoning that a text is
 * the only thing that cannot be recalled. But `decide` reads its repeat rules
 * from the ledger, so an action that never wrote to it stayed at zero touches
 * for ever — a once-only "add a note" would have written the same line onto a
 * customer's timeline every morning for the whole length of its window. No
 * test of `decide` could have caught it, because `decide` was right; the
 * caller never recorded the answer.
 *
 * Run by `npm run test:server`, which supplies the emulator.
 */
import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";

import { fakeServiceAccountB64 } from "./helpers/fakeServiceAccount.mjs";

const PROJECT = process.env.VIEW_TEST_PROJECT ?? "demo-grimebusters-views";

assert.ok(
  process.env.FIRESTORE_EMULATOR_HOST,
  "FIRESTORE_EMULATOR_HOST is not set — run this through `npm run test:server`, " +
    "never against a real project: it writes to the customers collection.",
);

process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountB64(PROJECT);

const { runAutomation, evaluateAutomation, newBudget } = await import(
  "@/lib/server/automationRun.ts"
);
const { clampGuards, defaultConditions, defaultGuards } = await import("@/lib/automations.ts");
const { adminDb } = await import("@/lib/server/admin.ts");
const { hourInBusinessTimezone } = await import("@/lib/notifications/quietHours.ts");
const { Timestamp } = await import("firebase-admin/firestore");

const ORG = "grime-busters";
const DAY = 86_400_000;

/**
 * Noon today in the business's timezone, handed to every run below.
 *
 * Each automation only acts inside its send window (9:00–17:00 Louisville by
 * default), so on the real clock these tests passed during the working day
 * and failed every evening — "the first run acts: 0 !== 1" from a run that
 * was correctly refusing to act at 8 pm. What is under test here is the
 * ledger, not the window (tests/automations.test.mjs covers the window), so
 * the clock is pinned somewhere the window is always open.
 *
 * Today's noon rather than a fixed date, and the leads below are dated from
 * it too, so a lead "1 day ago" is exactly one day before the run. Dating them
 * from the real clock instead shifted "Due in 2 days" to "Due in 3 days"
 * whenever the suite ran in the evening.
 */
const NOON = (() => {
  const now = new Date();
  const fromNoon = hourInBusinessTimezone(now) - 12;
  return new Date(now.getTime() - fromNoon * 60 * 60 * 1000);
})();

// One Admin app, the same one the code under test uses. A second named app
// here breaks lib/server/admin.ts outright — see the comment in
// tests/documentViews.server.test.mjs.
const customers = () => adminDb().collection("customers");

async function wipe(name) {
  const snap = await adminDb().collection(name).get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
}

beforeEach(async () => {
  await Promise.all([wipe("customers"), wipe("automationTouches"), wipe("notifications")]);
});

/** A lead sitting in "estimate sent", last contacted `ago` days back. */
async function lead({ phone = "502-555-0100", ago = 10, org = ORG } = {}) {
  const ref = customers().doc();
  await ref.set({
    orgId: org,
    firstName: "Marta",
    lastName: "Reyes",
    phone,
    address: "12 Oak St, Crestwood KY",
    propertyType: "residential",
    pipelineStage: "estimate_sent",
    pipelineValue: 450,
    serviceTypes: ["pressure_washing"],
    notes: [],
    // Measured from the same pinned clock the runs use, so "10 days ago"
    // means ten days before the run, at any hour the suite happens to start.
    lastContactedAt: Timestamp.fromMillis(NOON.getTime() - ago * DAY),
    createdAt: Timestamp.fromMillis(NOON.getTime()),
  });
  return ref.id;
}

function noteAutomation(overrides = {}) {
  return {
    id: "auto-1",
    name: "Nudge note",
    enabled: true,
    trigger: "lead_idle",
    conditions: defaultConditions(),
    action: { kind: "add_note", body: "Chase {first_name} about the quote.", stage: null },
    guards: clampGuards({ ...defaultGuards(), afterDays: 3, staleAfterDays: 60 }),
    ...overrides,
  };
}

async function notesOf(id) {
  const snap = await customers().doc(id).get();
  return snap.get("notes") ?? [];
}

describe("the send ledger stops an automation repeating itself", () => {
  test("a once-only automation acts once, however many times the cron runs", async () => {
    const id = await lead();

    const first = await runAutomation(ORG, noteAutomation(), newBudget(), NOON);
    assert.equal(first.sent, 1, "the first run acts");
    assert.equal((await notesOf(id)).length, 1);

    // The same automation, the same day, the same customer. Before the fix
    // this wrote a second identical note, and would have kept going daily.
    const second = await runAutomation(ORG, noteAutomation(), newBudget(), NOON);
    assert.equal(second.sent, 0, `second run sent ${second.sent}`);
    assert.equal((await notesOf(id)).length, 1, "still exactly one note");
  });

  test("and the ledger is what records it, keyed per automation", async () => {
    await lead();
    await runAutomation(ORG, noteAutomation(), newBudget(), NOON);

    const ledger = await adminDb().collection("automationTouches").get();
    assert.equal(ledger.size, 1, "one ledger row");
    const row = ledger.docs[0].data();
    assert.equal(row.touches, 1);
    assert.equal(row.automationId, "auto-1");
    assert.equal(row.orgId, ORG);

    // A different automation has its own count, so adding one does not
    // silently use up another's allowance.
    const other = await runAutomation(ORG, noteAutomation({ id: "auto-2" }), newBudget(), NOON);
    assert.equal(other.sent, 1, "a different automation still acts");
  });

  test("an internal note does not count as having contacted the customer", async () => {
    // This is what the test above was really failing on. appendNote marks the
    // customer contacted unless told otherwise, so a note the app wrote to
    // itself stamped lastContactedAt — which is the field the "lead idle"
    // trigger and the pipeline's untouched-for-a-week flag both measure from.
    // One automation adding a note therefore silenced every automation waiting
    // for a quiet lead.
    const id = await lead({ ago: 10 });
    const before = (await customers().doc(id).get()).get("lastContactedAt").toMillis();

    await runAutomation(ORG, noteAutomation(), newBudget(), NOON);

    const after = (await customers().doc(id).get()).get("lastContactedAt").toMillis();
    assert.equal(after, before, "lastContactedAt must not move when a note is added");
  });

  test("merge fields are filled in a note, not left as braces", async () => {
    // The note action did not render its template at first, so a timeline
    // entry read "Chase {first_name} about the quote."
    const id = await lead();
    await runAutomation(ORG, noteAutomation(), newBudget(), NOON);
    const [note] = await notesOf(id);
    assert.equal(note.text, "Chase Marta about the quote.");
    assert.doesNotMatch(note.text, /\{/, note.text);
  });
});

describe("one person, several records", () => {
  test("duplicate records on one phone number are acted on once", async () => {
    // The Meta lead webhook creates a fresh record per form submission, so one
    // handset genuinely sits in the database several times.
    const a = await lead({ phone: "(502) 555-0199" });
    const b = await lead({ phone: "502-555-0199" });

    const result = await runAutomation(ORG, noteAutomation(), newBudget(), NOON);
    assert.equal(result.sent, 1, `acted on ${result.sent} of 2 records for one number`);

    const total = (await notesOf(a)).length + (await notesOf(b)).length;
    assert.equal(total, 1, "exactly one note across both records");
  });

  test("two different people both get one", async () => {
    await lead({ phone: "502-555-0101" });
    await lead({ phone: "502-555-0102" });
    const result = await runAutomation(ORG, noteAutomation(), newBudget(), NOON);
    assert.equal(result.sent, 2);
  });
});

describe("the caps actually bind", () => {
  test("the per-automation daily cap holds the rest back", async () => {
    for (const last of ["0201", "0202", "0203"]) {
      await lead({ phone: `502-555-${last}` });
    }
    const capped = noteAutomation({
      guards: clampGuards({ ...defaultGuards(), afterDays: 3, staleAfterDays: 60, maxPerRun: 2 }),
    });
    const result = await runAutomation(ORG, capped, newBudget(), NOON);
    assert.equal(result.sent, 2);
    assert.equal(result.held, 1, "the third is held, not dropped silently");
  });

  test("the run-wide budget holds everything back once spent", async () => {
    await lead();
    const spent = { ...newBudget(), remaining: 0 };
    const result = await runAutomation(ORG, noteAutomation(), spent, NOON);
    assert.equal(result.sent, 0);
    assert.equal(result.held, 1);
  });

  test("a deadline already passed stops the run rather than overrunning it", async () => {
    // Both this and the quote follow-up share one sixty-second function.
    await lead();
    const late = { remaining: 40, deadlineMs: Date.now() - 1 };
    const result = await runAutomation(ORG, noteAutomation(), late, NOON);
    assert.equal(result.sent, 0);
    assert.equal(result.held, 1);
  });
});

describe("what the preview sees", () => {
  test("it reports who would be reached without touching anything", async () => {
    const id = await lead();
    const { candidates } = await evaluateAutomation(ORG, noteAutomation(), NOON);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].decision.send, true);
    assert.equal(candidates[0].customerName, "Marta Reyes");
    assert.equal(candidates[0].message, "Chase Marta about the quote.");

    // Nothing written: no note, no ledger row.
    assert.equal((await notesOf(id)).length, 0);
    assert.equal((await adminDb().collection("automationTouches").get()).size, 0);
  });

  test("a refusal comes back with the reason the screen shows", async () => {
    await lead({ ago: 1 });
    const { candidates } = await evaluateAutomation(ORG, noteAutomation(), NOON);
    assert.equal(candidates[0].decision.send, false);
    assert.match(candidates[0].decision.reason, /Due in 2 days/);
  });

  test("an estimate too old to start is named as such", async () => {
    await lead({ ago: 400 });
    const { candidates } = await evaluateAutomation(ORG, noteAutomation(), NOON);
    assert.equal(candidates[0].decision.send, false);
    assert.match(candidates[0].decision.reason, /too old/i);
  });
});

describe("another business's records are not touched", () => {
  test("the Admin SDK bypasses rules, so the runner filters orgId itself", async () => {
    const theirs = await lead({ org: "someone-else", phone: "502-555-0777" });
    const result = await runAutomation(ORG, noteAutomation(), newBudget(), NOON);
    assert.equal(result.sent, 0, "nothing of theirs was acted on");
    assert.equal(result.considered, 0, "and nothing of theirs was even considered");
    assert.equal((await notesOf(theirs)).length, 0);
  });
});
