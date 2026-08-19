/**
 * Tests for the on-site job sequence and the texts it sends.
 *
 * The wording is the part worth pinning: these messages go to real customers
 * from an unknown number, and the failure modes are not crashes. A greeting
 * that reads "Hi ," or a signature that reads "This is  from Grime Busters"
 * looks like spam, and the customer's response to spam is to block the number
 * the business texts everybody from.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  JOB_STEPS,
  STEP_BY_FIELD,
  STEP_FIELD,
  STEP_SMS_REASON,
  firstNameOf,
  isJobStep,
  signOffBody,
  stepProblem,
  stepTaken,
  stepsTaken,
} = await import("../lib/jobFlow.ts");

const { enRouteText, greetingFor, jobFinishedText, jobStartedText, PAYMENT_HANDLES } =
  await import("../lib/messages.ts");

/* ------------------------------------------------------------- the texts */

describe("the en-route text", () => {
  test("greets the customer by name", () => {
    assert.match(enRouteText("Marta"), /^Hi Marta, /);
  });

  test("a customer with no name still gets a sentence that reads", () => {
    // A pin dropped at a door has an address long before it has a name.
    for (const missing of ["", "   ", null, undefined]) {
      const text = enRouteText(missing);
      assert.match(text, /^Hi there, /);
      assert.doesNotMatch(text, /Hi ,|Hi  /, `broken merge: ${text}`);
    }
  });

  test("it says who is coming, in full", () => {
    // "Grime Busters" alone is not what is on the invoice or the truck.
    assert.match(enRouteText("Marta"), /Grime Busters KY LLC/);
    assert.match(enRouteText("Marta"), /en route to your scheduled appointment/);
  });
});

describe("the starting-job text", () => {
  const text = jobStartedText("Noah");

  test("is signed by the person who tapped it", () => {
    assert.match(text, /This is Noah from Grime Busters KY LLC/);
  });

  test("gives the customer a number that is not the technician's", () => {
    // The tech is about to be holding a pressure washer. The escalation path
    // has to be the owner.
    assert.match(text, /Nicolas @ 502-599-6855/);
  });
});

describe("the job-finished text", () => {
  const text = jobFinishedText("Noah");

  test("names every way the customer can pay", () => {
    assert.match(text, /checks made out to Grime Busters KY LLC/);
    assert.match(text, /cash/);
    assert.match(text, new RegExp(`Venmo ${PAYMENT_HANDLES.venmo.replace("@", "@")}`));
    assert.match(text, /Cash App \$GrimeBustersKYLLC/);
  });

  test("the handles are exact", () => {
    // A payment handle with a character wrong sends somebody's money to a
    // stranger, and no test failure anywhere else would catch it.
    assert.equal(PAYMENT_HANDLES.venmo, "@NicolasTimmons");
    assert.equal(PAYMENT_HANDLES.cashApp, "$GrimeBustersKYLLC");
  });

  test("it falls back to a phone number when none of them work", () => {
    assert.match(text, /reach out to Nicolas at 502-599-6855/);
  });

  test("it fits inside two SMS segments", () => {
    // Not a style rule — a third segment is a third charge on every job, and
    // this is the longest template in the app. 306 is the GSM-7 limit for two
    // concatenated segments (153 each, after the header).
    assert.ok(text.length <= 306, `${text.length} characters`);
  });
});

/* ----------------------------------------------------------- who signs it */

describe("who the text is signed by", () => {
  test("the first name only", () => {
    assert.equal(firstNameOf("Noah Perkins"), "Noah");
    assert.equal(firstNameOf("Nicolas"), "Nicolas");
  });

  test("extra whitespace does not become the name", () => {
    assert.equal(firstNameOf("  Noah   Perkins "), "Noah");
  });

  test("a missing name never produces an empty signature", () => {
    // "This is  from Grime Busters KY LLC" reads as a broken scam text.
    for (const missing of ["", "   ", null, undefined]) {
      assert.equal(firstNameOf(missing), "your technician");
      assert.doesNotMatch(jobStartedText(firstNameOf(missing)), /This is\s+from/);
    }
  });
});

/* ------------------------------------------------------ when it is allowed */

describe("when a step can be taken", () => {
  const live = { status: "scheduled" };

  test("a normal job with a phone number is fine", () => {
    assert.equal(stepProblem(live, "5025550100"), null);
  });

  test("a cancelled job is not", () => {
    // Telling somebody the crew is on the way to a job that was called off is
    // worse than saying nothing at all.
    assert.match(stepProblem({ status: "cancelled" }, "5025550100"), /cancelled/i);
  });

  test("a customer with no phone is not", () => {
    for (const missing of ["", "   ", null, undefined]) {
      assert.match(stepProblem(live, missing), /phone/i);
    }
  });

  test("steps taken out of order are allowed", () => {
    // Real jobs go sideways: the crew starts before anybody taps "en route".
    // Refusing the tap teaches people to stop tapping.
    assert.equal(stepProblem({ status: "in_progress" }, "5025550100"), null);
    assert.equal(stepProblem({ status: "complete" }, "5025550100"), null);
  });
});

/* ---------------------------------------------------------- the sign-off */

describe("what the owner is told", () => {
  test("carries the job, the customer and the money", () => {
    const body = signOffBody({
      service: "Pressure washing",
      customer: "Marta Oakley",
      money: "$300",
      collected: true,
    });
    assert.match(body, /Pressure washing/);
    assert.match(body, /Marta Oakley/);
    assert.match(body, /\$300/);
  });

  test("an unpaid job is the one that shouts", () => {
    // This is the whole point of asking. A finished job nobody paid for is the
    // one the owner has to chase, so it must not read like the paid one at a
    // glance on a lock screen.
    const paid = signOffBody({
      service: "Landscaping",
      customer: "Dev Castellano",
      money: "$540",
      collected: true,
    });
    const unpaid = signOffBody({
      service: "Landscaping",
      customer: "Dev Castellano",
      money: "$540",
      collected: false,
    });
    assert.match(paid, /Payment collected/);
    assert.match(unpaid, /NOT COLLECTED/);
    assert.notEqual(paid, unpaid);
  });
});

/* -------------------------------------------------------------- the steps */

describe("the step catalogue", () => {
  test("every step has a field and a reason", () => {
    for (const step of JOB_STEPS) {
      assert.equal(typeof STEP_FIELD[step], "string");
      assert.equal(typeof STEP_SMS_REASON[step], "string");
    }
  });

  test("no two steps stamp the same field", () => {
    const fields = [
      ...JOB_STEPS.map((step) => STEP_FIELD[step]),
      ...JOB_STEPS.map((step) => STEP_BY_FIELD[step]),
    ];
    assert.equal(new Set(fields).size, fields.length);
  });

  test("the when and the who fields are paired, never crossed", () => {
    // A step that stamps enRouteAt alongside startedBy would attribute the
    // wrong person to the wrong moment, and nothing on screen would show it.
    for (const step of JOB_STEPS) {
      assert.match(STEP_FIELD[step], /At$/);
      assert.match(STEP_BY_FIELD[step], /By$/);
      assert.equal(
        STEP_FIELD[step].replace(/At$/, ""),
        STEP_BY_FIELD[step].replace(/By$/, ""),
      );
    }
  });

  test("an unknown step is not a step", () => {
    assert.equal(isJobStep("en_route"), true);
    assert.equal(isJobStep("complete"), false, "complete sends no text");
    assert.equal(isJobStep("whatever_next_year_adds"), false);
    assert.equal(isJobStep(undefined), false);
  });
});

describe("how far through a job is", () => {
  const stamp = { toMillis: () => 1 };

  test("counts the stamps that are there", () => {
    assert.equal(stepsTaken({}), 0);
    assert.equal(stepsTaken({ enRouteAt: stamp }), 1);
    assert.equal(
      stepsTaken({ enRouteAt: stamp, startedAt: stamp, finishedAt: stamp }),
      3,
    );
  });

  test("counts them even when they arrive out of order", () => {
    // Somebody who forgot to tap "en route" and only tapped "finished" is one
    // step in, not zero.
    assert.equal(stepsTaken({ finishedAt: stamp }), 1);
    assert.equal(stepsTaken({ startedAt: stamp, finishedAt: stamp }), 2);
  });

  test("a null stamp is not a step taken", () => {
    assert.equal(stepTaken(null), false);
    assert.equal(stepTaken(undefined), false);
    assert.equal(stepsTaken({ enRouteAt: null, startedAt: null }), 0);
  });
});

describe("the greeting on its own", () => {
  test("is reusable and never leaves a dangling comma", () => {
    assert.equal(greetingFor("Marta"), "Hi Marta");
    assert.equal(greetingFor(" Marta "), "Hi Marta");
    assert.equal(greetingFor(null), "Hi there");
  });
});
