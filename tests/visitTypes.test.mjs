/**
 * What kind of visit a job is.
 *
 * The point of the distinction is everything that follows from money, so the
 * tests weigh "is this billable" and "what does the customer's text say"
 * over the labels.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { VISIT_TYPES, VISIT_LABEL, asVisitType, isBillable, visitPhrase, visitTitle } = await import(
  "../lib/visitTypes.ts"
);
const { jobConfirmationText, visitFinishedText, jobFinishedText } = await import("../lib/messages.ts");

describe("which visits are paid work", () => {
  test("only a service job is billable", () => {
    assert.equal(isBillable("service"), true);
    for (const visit of ["estimate", "walkthrough", "follow_up", "touch_up"]) {
      assert.equal(isBillable(visit), false, `${visit} was treated as paid work`);
    }
  });

  test("a job saved before visit types existed is a service job", () => {
    assert.equal(asVisitType(undefined), "service");
    assert.equal(isBillable(undefined), true);
    assert.equal(isBillable(null), true);
  });

  test("an unknown stored value falls back to a service job, not to free", () => {
    // The other direction would quietly stop asking for payment on real work.
    assert.equal(asVisitType("estimate_visit"), "service");
    assert.equal(asVisitType(7), "service");
  });

  test("every visit has a label", () => {
    for (const visit of VISIT_TYPES) assert.ok(VISIT_LABEL[visit]);
    assert.equal(VISIT_LABEL.estimate, "Estimate / consultation");
  });
});

describe("what the customer is told", () => {
  test("the phrase that follows 'your'", () => {
    assert.equal(visitPhrase("service", "Pressure washing"), "pressure washing");
    assert.equal(visitPhrase("estimate", "Pressure washing"), "estimate visit for pressure washing");
    assert.equal(visitPhrase("walkthrough", "Landscaping"), "site walkthrough for landscaping");
    assert.equal(visitPhrase("follow_up", "Landscaping"), "follow-up visit");
    assert.equal(visitPhrase("touch_up", "Pressure washing"), "touch-up visit for pressure washing");
  });

  test("never promises a free estimate", () => {
    for (const visit of VISIT_TYPES) {
      assert.doesNotMatch(visitPhrase(visit, "Pressure washing"), /free/i);
    }
  });

  test("the booking text reads naturally for an estimate", () => {
    const text = jobConfirmationText(visitPhrase("estimate", "Pressure washing"), new Date(2026, 9, 24, 10, 0));
    assert.match(text, /your estimate visit for pressure washing is scheduled for Saturday Oct 24 at 10:00 AM/);
  });

  test("an unpaid visit's finished text never asks for payment", () => {
    for (const visit of ["estimate", "walkthrough", "follow_up", "touch_up"]) {
      const text = visitFinishedText("Dana", visit);
      assert.doesNotMatch(text, /payment|Venmo|Cash App|cash/i, visit);
      assert.match(text, /Reply STOP to opt out\.$/);
    }
    // ...while the paid-work one still does.
    assert.match(jobFinishedText("Dana"), /awaiting payment/);
  });

  test("an estimate or walkthrough says the estimate is coming", () => {
    assert.match(visitFinishedText("Dana", "estimate"), /send your estimate shortly/);
    assert.match(visitFinishedText("Dana", "walkthrough"), /send your estimate shortly/);
    assert.doesNotMatch(visitFinishedText("Dana", "touch_up"), /estimate/);
  });
});

describe("the calendar title", () => {
  test("names the visit, and leaves a service job as just the service", () => {
    assert.equal(visitTitle("estimate", "Pressure washing"), "Estimate · Pressure washing");
    assert.equal(visitTitle("service", "Pressure washing"), "Pressure washing");
    assert.equal(visitTitle(undefined, "Snow removal"), "Snow removal");
  });
});
