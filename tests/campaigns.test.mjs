/**
 * Seasonal campaigns: who gets a marketing text, and what came of it.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { campaignAudience, outcomeFor, campaignResults, inSeason, CAMPAIGN_TEMPLATES, RESULT_WINDOW_DAYS } = await import(
  "../lib/campaigns.ts"
);

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 15); // mid September
const aeration = CAMPAIGN_TEMPLATES.find((t) => t.id === "fall_aeration");
const consent = { granted: true };
const cust = (id, over = {}) => ({ id, phone: "5025550100", status: "customer", smsConsent: consent, smsOptOut: null, ...over });
const job = (customerId, services, over = {}) => ({ customerId, services, status: "complete", at: now - 30 * DAY, createdAt: now - 40 * DAY, ...over });
const allow = () => ({ allowed: true, reason: "" });

describe("who gets it", () => {
  test("existing mowing customers with consent, who haven't had it", () => {
    const a = campaignAudience(aeration, [cust("a"), cust("b")], [job("a", ["mowing"]), job("b", ["pressure_washing"])], [], now, allow);
    assert.deepEqual(a.eligible.map((c) => c.id), ["a"]);
    assert.equal(a.excluded.length, 0); // b isn't in the audience at all
    assert.equal(a.outOfScope, 1); // …but is counted, so the screen can say why
  });

  test("all clients: everyone who is a client, whatever they bought; door leads never", () => {
    const people = [
      cust("wash"), // pressure washing only
      cust("marked"), // marked a customer, no jobs in the app yet
      cust("lead", { status: "interested" }), // a door lead
      cust("stopped", { status: "interested" }),
    ];
    const jobs = [job("wash", ["pressure_washing"]), job("stopped", ["mowing"], { status: "scheduled" })];
    const a = campaignAudience(aeration, people, jobs, [], now, allow, "all_clients");
    assert.deepEqual(a.eligible.map((c) => c.id).sort(), ["marked", "wash"]);
    assert.equal(a.outOfScope, 0);
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
