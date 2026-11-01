/**
 * Importing the replies Twilio kept while the webhook was not connected.
 *
 * The rules that matter: each reply lands on the right client, nothing is
 * filed twice however many times the import runs, and a number nobody has on
 * file is kept rather than dropped.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { planReplyImport, plannedCount, replyNoteId } = await import("../lib/replyImport.ts");

const reply = (sid, from, body, sentAt) => ({ sid, from, body, sentAt });
const customer = (id, phone, noteIds = []) => ({ id, phone, noteIds: new Set(noteIds) });

describe("planning an import of old replies", () => {
  test("a reply lands on the client with that number, however it was typed", () => {
    const plan = planReplyImport(
      [reply("SM1", "+15025550147", "Yes please, Saturday works", 1000)],
      [customer("tyler", "(502) 555-0147")],
    );
    assert.deepEqual(plan.byCustomer.get("tyler"), [
      { id: replyNoteId("SM1"), sid: "SM1", body: "Yes please, Saturday works", sentAt: 1000 },
    ]);
    assert.equal(plan.unmatched.length, 0);
    assert.equal(plannedCount(plan), 1);
  });

  test("replies are filed oldest first, whatever order Twilio lists them in", () => {
    const plan = planReplyImport(
      [reply("SM2", "5025550147", "second", 2000), reply("SM1", "5025550147", "first", 1000)],
      [customer("tyler", "5025550147")],
    );
    assert.deepEqual(
      plan.byCustomer.get("tyler").map((note) => note.body),
      ["first", "second"],
    );
  });

  test("a reply already on the timeline is not filed again", () => {
    const plan = planReplyImport(
      [reply("SM1", "5025550147", "hi", 1000), reply("SM2", "5025550147", "again", 2000)],
      [customer("tyler", "5025550147", [replyNoteId("SM1")])],
    );
    assert.deepEqual(plan.byCustomer.get("tyler").map((note) => note.sid), ["SM2"]);
    assert.equal(plan.alreadyFiled, 1);
  });

  test("running the plan on its own result files nothing the second time", () => {
    const replies = [reply("SM1", "5025550147", "hi", 1000)];
    const first = planReplyImport(replies, [customer("tyler", "5025550147")]);
    const ids = first.byCustomer.get("tyler").map((note) => note.id);
    const second = planReplyImport(replies, [customer("tyler", "5025550147", ids)]);
    assert.equal(plannedCount(second), 0);
    assert.equal(second.alreadyFiled, 1);
  });

  test("a number nobody has on file is kept for the Messages screen", () => {
    const plan = planReplyImport(
      [reply("SM9", "+15029990000", "Do you do gutters?", 1000)],
      [customer("tyler", "5025550147")],
    );
    assert.equal(plan.byCustomer.size, 0);
    assert.deepEqual(plan.unmatched.map((r) => r.sid), ["SM9"]);
  });

  test("two records with one number: the first on file gets it, like the live webhook", () => {
    const plan = planReplyImport(
      [reply("SM1", "5025550147", "hi", 1000)],
      [customer("first", "502-555-0147"), customer("second", "5025550147")],
    );
    assert.ok(plan.byCustomer.has("first"));
    assert.ok(!plan.byCustomer.has("second"));
  });

  test("blank messages and repeats of one SID are skipped", () => {
    const plan = planReplyImport(
      [
        reply("SM1", "5025550147", "   ", 1000),
        reply("", "5025550147", "no sid", 1000),
        reply("SM2", "5025550147", "real", 2000),
        reply("SM2", "5025550147", "real", 2000),
      ],
      [customer("tyler", "5025550147")],
    );
    assert.equal(plannedCount(plan), 1);
    assert.equal(plan.skipped, 2);
  });

  test("the note id is the one the live webhook files under", () => {
    assert.equal(replyNoteId("SMabc"), "twilio-SMabc");
    assert.equal(replyNoteId(" SMabc "), "twilio-SMabc");
  });
});
