/**
 * Asking for a review, once, and only when the money arrived.
 *
 * Both failure modes here are invisible from the app and visible to the
 * customer: texting somebody twice, and texting somebody who has not paid to
 * thank them for paying. Neither shows up in a test that only walks the happy
 * path, so the refusals are what is pinned hardest below.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { shouldAskForReview, normalizeReviewUrl } = await import("../lib/reviewRequest.ts");
const { reviewRequestText } = await import("../lib/messages.ts");

const at = (millis) => ({ toMillis: () => millis });

/** A job that has just been signed off as paid, with everything configured. */
const paid = {
  paymentCollected: true,
  reviewRequestedAt: null,
  reviewUrl: "https://g.page/r/ExampleToken/review",
  customerPhone: "(502) 555-0147",
};

describe("deciding whether to ask", () => {
  test("paid, configured, not yet asked — send it", () => {
    assert.deepEqual(shouldAskForReview(paid), { ask: true });
  });

  test("not paid means no thank-you for paying", () => {
    const verdict = shouldAskForReview({ ...paid, paymentCollected: false });
    assert.equal(verdict.ask, false);
    assert.match(verdict.reason, /payment/i);
  });

  test("nobody asked is not a yes", () => {
    // paymentCollected is null on a job completed before the question existed,
    // and through any path that does not ask. Reading that as "paid" would
    // thank somebody for money they still owe.
    const verdict = shouldAskForReview({ ...paid, paymentCollected: null });
    assert.equal(verdict.ask, false);
  });

  test("never twice for the same job", () => {
    const verdict = shouldAskForReview({ ...paid, reviewRequestedAt: at(1_000) });
    assert.equal(verdict.ask, false);
    assert.match(verdict.reason, /already/i);
  });

  test("no link configured means nothing is sent", () => {
    for (const reviewUrl of ["", "   ", null, undefined]) {
      const verdict = shouldAskForReview({ ...paid, reviewUrl });
      assert.equal(verdict.ask, false, JSON.stringify(reviewUrl));
      assert.match(verdict.reason, /link/i);
    }
  });

  test("a customer with no number is skipped, not attempted", () => {
    const verdict = shouldAskForReview({ ...paid, customerPhone: "" });
    assert.equal(verdict.ask, false);
    assert.match(verdict.reason, /phone/i);
  });

  test("every refusal says why", () => {
    // "Nothing happened" is the hardest bug to chase on a feature that fires
    // from one button press on a driveway a week ago.
    const refusals = [
      { ...paid, paymentCollected: false },
      { ...paid, reviewRequestedAt: at(1) },
      { ...paid, reviewUrl: "" },
      { ...paid, customerPhone: null },
    ];
    for (const input of refusals) {
      const verdict = shouldAskForReview(input);
      assert.equal(verdict.ask, false);
      assert.ok(verdict.reason && verdict.reason.length > 10, JSON.stringify(verdict));
    }
  });
});

describe("the configured link", () => {
  test("an ordinary Google review link survives", () => {
    assert.equal(
      normalizeReviewUrl("https://g.page/r/ExampleToken/review"),
      "https://g.page/r/ExampleToken/review",
    );
  });

  test("whitespace from a paste is trimmed", () => {
    assert.equal(
      normalizeReviewUrl("  https://g.page/r/ExampleToken/review  "),
      "https://g.page/r/ExampleToken/review",
    );
  });

  test("anything that is not a link is nothing", () => {
    // This value arrives by somebody pasting it into a dashboard. A link that
    // is not a link goes out to every paying customer before anyone notices,
    // and each one is a real text that cannot be recalled.
    for (const junk of ["", "   ", "google review", "g.page/r/Token", null, undefined]) {
      assert.equal(normalizeReviewUrl(junk), "", JSON.stringify(junk));
    }
  });

  test("only http and https", () => {
    for (const scheme of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd"]) {
      assert.equal(normalizeReviewUrl(scheme), "", scheme);
    }
  });
});

describe("what the customer reads", () => {
  const url = "https://g.page/r/ExampleToken/review";

  test("it confirms the payment before it asks for anything", () => {
    const text = reviewRequestText("Marta", url);
    const received = text.toLowerCase().indexOf("received your payment");
    const asked = text.toLowerCase().indexOf("review");
    assert.ok(received >= 0, "says the payment arrived");
    assert.ok(asked > received, "and says so before asking for the review");
  });

  test("the link is last and on its own line", () => {
    // Punctuation immediately after a URL gets swallowed into the href by some
    // messaging apps, and the customer taps through to a 404.
    const text = reviewRequestText("Marta", url);
    assert.ok(text.endsWith(url), "nothing after the link");
    assert.match(text, /\n\n/, "separated from the sentence above it");
  });

  test("it carries the opt-out line like every other template", () => {
    assert.match(reviewRequestText("Marta", url), /Reply STOP to opt out\./);
  });

  test("a customer with no first name still gets a sentence, not a blank", () => {
    assert.match(reviewRequestText(null, url), /^Hi there,/);
  });

  test("no link means no message at all", () => {
    // Asking for a review and offering nowhere to leave one is worse than
    // sending nothing. The caller reads "" as "don't send".
    assert.equal(reviewRequestText("Marta", ""), "");
    assert.equal(reviewRequestText("Marta", "   "), "");
  });
});
