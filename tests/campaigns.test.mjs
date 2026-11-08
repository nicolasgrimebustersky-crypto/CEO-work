/**
 * Seasonal campaigns: who gets a marketing text, and what came of it.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { campaignAudience, outcomeFor, campaignResults, inSeason, CAMPAIGN_TEMPLATES, RESULT_WINDOW_DAYS, recentCustomers, marketingAllowed, RELATIONSHIP_DAYS, asConsentMode, inBatches, CAMPAIGN_BATCH } = await import(
  "../lib/campaigns.ts"
);

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 15); // mid September
const aeration = CAMPAIGN_TEMPLATES.find((t) => t.id === "fall_aeration");
const consent = { granted: true };
// Each fake client gets their own number: one text per number is a rule.
let nextPhone = 100;
const cust = (id, over = {}) => ({ id, phone: `502555${String(nextPhone++).padStart(4, "0")}`, status: "customer", smsConsent: consent, smsOptOut: null, ...over });
const job = (customerId, services, over = {}) => ({ customerId, services, status: "complete", at: now - 30 * DAY, createdAt: now - 40 * DAY, ...over });
const allow = () => ({ allowed: true, reason: "" });

describe("no yes on file: clients from the last 18 months", () => {
  test("a finished job inside 18 months counts; older, unfinished, or in the future doesn't", () => {
    assert.equal(RELATIONSHIP_DAYS, 548);
    const r = recentCustomers(
      [
        { customerId: "recent", status: "complete", at: now - 500 * DAY },
        { customerId: "old", status: "complete", at: now - 600 * DAY },
        { customerId: "booked", status: "scheduled", at: now - 10 * DAY },
        { customerId: "later", status: "complete", at: now + 5 * DAY },
      ],
      now,
    );
    assert.deepEqual([...r], ["recent"]);
  });

  test("everyone mode needs no yes and no job; an unknown mode from a request is the strict one", () => {
    assert.equal(marketingAllowed(false, "everyone", new Set(), "x"), true);
    assert.equal(asConsentMode("everyone"), "everyone");
    assert.equal(asConsentMode("relationship"), "relationship");
    assert.equal(asConsentMode("anything"), "recorded");
    assert.equal(asConsentMode(undefined), "recorded");
  });

  test("a recorded yes is always enough; a recent job only in the relationship mode", () => {
    const recent = new Set(["a"]);
    assert.equal(marketingAllowed(true, "recorded", new Set(), "x"), true);
    assert.equal(marketingAllowed(false, "recorded", recent, "a"), false);
    assert.equal(marketingAllowed(false, "relationship", recent, "a"), true);
    assert.equal(marketingAllowed(false, "relationship", recent, "b"), false);
  });

  test("the audience: recent clients without a yes are in, old ones and STOPs are out", () => {
    const people = [
      cust("recent", { smsConsent: null }),
      cust("old", { smsConsent: null }),
      cust("stopped", { smsConsent: null }),
    ];
    const jobs = [
      job("recent", ["pressure_washing"], { at: now - 100 * DAY }),
      job("old", ["pressure_washing"], { at: now - 700 * DAY }),
      job("stopped", ["pressure_washing"], { at: now - 100 * DAY }),
    ];
    const canSend = (c) => (c.id === "stopped" ? { allowed: false, reason: "replied STOP" } : { allowed: true, reason: "" });
    const a = campaignAudience(aeration, people, jobs, [], now, canSend, "all_clients", "relationship");
    assert.deepEqual(a.eligible.map((c) => c.id), ["recent"]);
    assert.deepEqual(a.excluded.map((e) => [e.customer.id, e.why]).sort(), [["old", "no_consent"], ["stopped", "cannot_text"]]);
    // "everyone": the old client is in too; STOP still wins.
    const all = campaignAudience(aeration, people, jobs, [], now, canSend, "all_clients", "everyone");
    assert.deepEqual(all.eligible.map((c) => c.id).sort(), ["old", "recent"]);
    assert.deepEqual(all.excluded.map((e) => [e.customer.id, e.why]), [["stopped", "cannot_text"]]);
    // The stricter mode leaves the recent one out too.
    assert.equal(campaignAudience(aeration, people, jobs, [], now, canSend, "all_clients", "recorded").eligible.length, 0);
  });
});

describe("who gets it", () => {
  test("existing mowing customers with consent, who haven't had it", () => {
    const a = campaignAudience(aeration, [cust("a"), cust("b")], [job("a", ["mowing"]), job("b", ["pressure_washing"])], [], now, allow);
    assert.deepEqual(a.eligible.map((c) => c.id), ["a"]);
    assert.equal(a.excluded.length, 0); // b isn't in the audience at all
    assert.equal(a.outOfScope, 1); // …but is counted, so the screen can say why
  });

  test("all clients: every record with a number, whatever its status or what it bought", () => {
    const people = [
      cust("wash"), // pressure washing only
      cust("marked"), // marked a customer, no jobs in the app yet
      cust("lead", { status: "interested" }), // a lead with a number
      cust("quoted", { status: "quoted" }),
      cust("nophone", { status: "lead", phone: "" }),
      cust("dnc", { status: "do_not_knock" }),
    ];
    const jobs = [job("wash", ["pressure_washing"])];
    const a = campaignAudience(aeration, people, jobs, [], now, allow, "all_clients", "everyone");
    assert.deepEqual(a.eligible.map((c) => c.id).sort(), ["lead", "marked", "quoted", "wash"]);
    assert.deepEqual(a.excluded.map((e) => [e.customer.id, e.why]).sort(), [["dnc", "do_not_knock"], ["nophone", "no_phone"]]);
    assert.equal(a.outOfScope, 0);
  });

  test("two records with one number get one text", () => {
    const people = [cust("a", { phone: "(502) 555-0100" }), cust("b", { phone: "+1 502 555 0100" }), cust("c", { phone: "502-555-0199" })];
    const a = campaignAudience(aeration, people, [], [], now, allow, "all_clients", "everyone");
    assert.deepEqual(a.eligible.map((c) => c.id), ["a", "c"]);
    assert.deepEqual(a.excluded.map((e) => [e.customer.id, e.why]), [["b", "same_number"]]);
  });

  test("a big list goes out in batches small enough to finish inside the server's 60 s", () => {
    const ids = Array.from({ length: 111 }, (_, i) => String(i));
    const batches = inBatches(ids);
    assert.equal(CAMPAIGN_BATCH, 40);
    assert.deepEqual(batches.map((b) => b.length), [40, 40, 31]);
    assert.deepEqual(batches.flat(), ids);
    assert.ok(CAMPAIGN_BATCH * 1.1 < 55, "40 texts spaced 1.1 s apart must fit in the 60 s limit with room to spare");
  });

  test("all clients still needs consent, and still skips anyone who already has it", () => {
    const a = campaignAudience(
      aeration,
      [cust("a", { smsConsent: null }), cust("b")],
      [job("a", ["pressure_washing"]), job("b", ["aeration"], { at: now - 20 * DAY })],
      [],
      now,
      allow,
      "all_clients",
    );
    assert.equal(a.eligible.length, 0);
    assert.deepEqual(a.excluded.map((e) => [e.customer.id, e.why]).sort(), [["a", "no_consent"], ["b", "has_it"]]);
  });

  test("a marketing text needs consent on file, not just no STOP", () => {
    const a = campaignAudience(aeration, [cust("a", { smsConsent: null })], [job("a", ["mowing"])], [], now, allow);
    assert.equal(a.eligible.length, 0);
    assert.equal(a.excluded[0].why, "no_consent");
  });

  test("STOP and do-not-contact win", () => {
    const stopped = campaignAudience(aeration, [cust("a")], [job("a", ["mowing"])], [], now, () => ({ allowed: false, reason: "replied STOP" }));
    assert.deepEqual([stopped.excluded[0].why, stopped.excluded[0].detail], ["cannot_text", "replied STOP"]);
    const dnk = campaignAudience(aeration, [cust("a", { status: "do_not_knock" })], [job("a", ["mowing"])], [], now, allow);
    assert.equal(dnk.excluded[0].why, "do_not_knock");
  });

  test("not offered what they already had, have booked, or were quoted", () => {
    const had = campaignAudience(aeration, [cust("a")], [job("a", ["mowing"]), job("a", ["aeration"], { at: now - 200 * DAY })], [], now, allow);
    assert.equal(had.excluded[0].why, "has_it");
    const booked = campaignAudience(aeration, [cust("a")], [job("a", ["mowing"]), job("a", ["aeration"], { status: "scheduled", at: now + 5 * DAY })], [], now, allow);
    assert.equal(booked.excluded[0].why, "has_it");
    const quoted = campaignAudience(aeration, [cust("a")], [job("a", ["mowing"])], [{ customerId: "a", kind: "estimate", status: "sent", services: ["aeration"], createdAt: now - 10 * DAY }], now, allow);
    assert.equal(quoted.excluded[0].why, "has_it");
    const longAgo = campaignAudience(aeration, [cust("a")], [job("a", ["mowing"]), job("a", ["aeration"], { at: now - 400 * DAY })], [], now, allow);
    assert.equal(longAgo.eligible.length, 1);
  });

  test("templates know their season", () => {
    assert.equal(inSeason(aeration, 9), true);
    assert.equal(inSeason(aeration, 4), false);
  });
});

describe("what came of it", () => {
  const sentAt = now;
  test("booked beats accepted beats quoted; outside the window doesn't count", () => {
    const jobs = [job("a", ["aeration"], { status: "scheduled", createdAt: sentAt + 3 * DAY })];
    const docs = [
      { customerId: "b", kind: "estimate", status: "accepted", services: ["aeration"], createdAt: sentAt + 2 * DAY },
      { customerId: "c", kind: "estimate", status: "sent", services: ["aeration"], createdAt: sentAt + 2 * DAY },
      { customerId: "d", kind: "estimate", status: "accepted", services: ["aeration"], createdAt: sentAt + (RESULT_WINDOW_DAYS + 1) * DAY },
      { customerId: "e", kind: "estimate", status: "draft", services: ["aeration"], createdAt: sentAt + DAY },
    ];
    assert.equal(outcomeFor("a", "aeration", sentAt, jobs, docs), "booked");
    assert.equal(outcomeFor("b", "aeration", sentAt, jobs, docs), "accepted");
    assert.equal(outcomeFor("c", "aeration", sentAt, jobs, docs), "quoted");
    assert.equal(outcomeFor("d", "aeration", sentAt, jobs, docs), "none");
    assert.equal(outcomeFor("e", "aeration", sentAt, jobs, docs), "none");
    const r = campaignResults(["a", "b", "c", "d", "e"], "aeration", sentAt, jobs, docs);
    assert.deepEqual([r.sent, r.booked, r.accepted, r.quoted, r.rate], [5, 1, 1, 1, 0.4]);
  });
});
