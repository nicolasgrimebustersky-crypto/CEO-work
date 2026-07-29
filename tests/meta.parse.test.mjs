/**
 * Unit tests for the Meta Lead Ads parsing and signature verification.
 *
 *   npm run test:meta
 *
 * These need no emulator and no network — they exercise the logic that decides
 * whether a webhook is genuine and what a lead form's answers actually mean.
 * Both are places where being quietly wrong is expensive: a bad signature check
 * lets anyone inject leads that auto-send SMS, and a bad field mapping silently
 * drops a customer's phone number.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test, describe } from "node:test";

const SECRET = "test-app-secret";

const { verifyMetaSignature, parseLead, parseWebhookBody } = await import(
  "../lib/meta/leads.ts"
);

function sign(body, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

const verify = (body, header) => verifyMetaSignature(body, header, SECRET);

describe("webhook signature", () => {
  const body = JSON.stringify({ object: "page", entry: [] });

  test("accepts a correctly signed body", () => {
    assert.equal(verify(body, sign(body)), true);
  });

  test("rejects a missing signature", () => {
    assert.equal(verify(body, null), false);
    assert.equal(verify(body, ""), false);
  });

  test("rejects a signature made with the wrong secret", () => {
    assert.equal(verify(body, sign(body, "not-the-secret")), false);
  });

  test("rejects a valid signature for different content", () => {
    // The exact attack this guards against: replaying a real signature against
    // a tampered payload.
    const tampered = JSON.stringify({ object: "page", entry: [{ evil: true }] });
    assert.equal(verify(tampered, sign(body)), false);
  });

  test("rejects a malformed header without throwing", () => {
    // timingSafeEqual throws on length mismatch, so this has to be handled.
    assert.equal(verify(body, "sha256=short"), false);
    assert.equal(verify(body, "garbage"), false);
  });
});

describe("webhook body parsing", () => {
  test("extracts leadgen ids", () => {
    const entries = parseWebhookBody({
      object: "page",
      entry: [
        {
          id: "page-1",
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "1234567890",
                page_id: "page-1",
                form_id: "form-9",
                created_time: 1700000000,
              },
            },
          ],
        },
      ],
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].leadgenId, "1234567890");
    assert.equal(entries[0].formId, "form-9");
  });

  test("coerces a numeric leadgen id to a string", () => {
    // Meta has sent both over the years, and an id compared as a number would
    // break the duplicate check.
    const entries = parseWebhookBody({
      object: "page",
      entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: 987 } }] }],
    });
    assert.equal(entries[0].leadgenId, "987");
    assert.equal(typeof entries[0].leadgenId, "string");
  });

  test("ignores non-leadgen changes and other objects", () => {
    assert.equal(
      parseWebhookBody({
        object: "page",
        entry: [{ changes: [{ field: "feed", value: { post_id: "x" } }] }],
      }).length,
      0,
    );
    assert.equal(
      parseWebhookBody({ object: "instagram", entry: [{ changes: [] }] }).length,
      0,
    );
  });

  test("survives junk without throwing", () => {
    for (const junk of [null, undefined, "", 42, {}, { entry: "nope" }]) {
      assert.equal(parseWebhookBody(junk).length, 0);
    }
  });

  test("handles several leads in one delivery", () => {
    const entries = parseWebhookBody({
      object: "page",
      entry: [
        { changes: [{ field: "leadgen", value: { leadgen_id: "a" } }] },
        { changes: [{ field: "leadgen", value: { leadgen_id: "b" } }] },
      ],
    });
    assert.deepEqual(entries.map((e) => e.leadgenId), ["a", "b"]);
  });
});

describe("lead field mapping", () => {
  const lead = (fields) => ({
    id: "lead-1",
    createdTime: "2026-07-28T10:00:00+0000",
    formId: "form-1",
    fields,
  });

  test("maps a standard form", () => {
    const parsed = parseLead(
      lead([
        { name: "first_name", values: ["Marta"] },
        { name: "last_name", values: ["Oakley"] },
        { name: "phone_number", values: ["+1 (502) 555-0147"] },
        { name: "email", values: ["marta@example.com"] },
      ]),
    );

    assert.equal(parsed.firstName, "Marta");
    assert.equal(parsed.lastName, "Oakley");
    assert.equal(parsed.email, "marta@example.com");
    // Punctuation stripped so it reaches toE164 in a usable shape.
    assert.equal(parsed.phone, "+15025550147");
  });

  test("splits a full_name form", () => {
    const parsed = parseLead(lead([{ name: "full_name", values: ["Ray Whitfield"] }]));
    assert.equal(parsed.firstName, "Ray");
    assert.equal(parsed.lastName, "Whitfield");
  });

  test("keeps multi-word surnames intact", () => {
    const parsed = parseLead(lead([{ name: "full_name", values: ["Ana de la Cruz"] }]));
    assert.equal(parsed.firstName, "Ana");
    assert.equal(parsed.lastName, "de la Cruz");
  });

  test("assembles an address from whatever parts the form asked for", () => {
    const parsed = parseLead(
      lead([
        { name: "street_address", values: ["1420 Oak Ridge Dr"] },
        { name: "city", values: ["La Grange"] },
        { name: "state", values: ["KY"] },
        { name: "zip_code", values: ["40031"] },
      ]),
    );
    assert.equal(parsed.address, "1420 Oak Ridge Dr, La Grange, KY, 40031");
  });

  test("leaves the address empty when the form asked for none", () => {
    // The common case for Instant Forms, and why leads land without a map pin.
    const parsed = parseLead(lead([{ name: "phone_number", values: ["5025550147"] }]));
    assert.equal(parsed.address, "");
  });

  test("preserves custom questions rather than dropping them", () => {
    // Field names depend on how the form was built, so anything unrecognised
    // has to survive into the timeline instead of vanishing.
    const parsed = parseLead(
      lead([
        { name: "first_name", values: ["Marta"] },
        { name: "which_service_do_you_need", values: ["Driveway wash"] },
        { name: "when_would_you_like_it_done", values: ["Next week"] },
      ]),
    );

    assert.equal(parsed.extras.length, 2);
    assert.deepEqual(parsed.extras[0], {
      label: "which service do you need",
      value: "Driveway wash",
    });
  });

  test("ignores empty answers", () => {
    const parsed = parseLead(
      lead([
        { name: "first_name", values: [""] },
        { name: "notes", values: [] },
      ]),
    );
    assert.equal(parsed.firstName, "");
    assert.equal(parsed.extras.length, 0);
  });
});
