/**
 * What actually happens in the database when a customer opens their quote.
 *
 * This file exists because of a Codex finding on the first version of the
 * feature: the only tests for this write were regexes run against the source,
 * which prove the code says something and never that it does it. A transaction
 * that reads the wrong field, an increment that double-counts, a boundary an
 * hour out — every one of those passes a source match.
 *
 * So these run the real `recordDocumentView` against a real Firestore
 * emulator, through the real Admin SDK, with real transactions. The feature's
 * whole value is that "Opened" is trustworthy; a false Opened sends somebody
 * chasing a decision the customer was never asked to make. That claim is worth
 * testing against a database rather than against a regex.
 *
 * Run by `npm run test:server`, which supplies the emulator.
 */
import assert from "node:assert/strict";
import { test, describe, before } from "node:test";

import { fakeServiceAccountB64 } from "./helpers/fakeServiceAccount.mjs";

const PROJECT = process.env.VIEW_TEST_PROJECT ?? "demo-grimebusters-views";

assert.ok(
  process.env.FIRESTORE_EMULATOR_HOST,
  "FIRESTORE_EMULATOR_HOST is not set — run this through `npm run test:server`, " +
    "never against a real project: it writes to the documents collection.",
);

// Set before the import: lib/server/admin.ts reads this once, at module load.
process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountB64(PROJECT);

const { recordDocumentView } = await import("@/lib/server/documentViews.ts");
const { adminDb } = await import("@/lib/server/admin.ts");
const { Timestamp } = await import("firebase-admin/firestore");

// Arranged and inspected through the same Admin app the code under test uses.
// A second, named app here looked tidier and broke the module outright:
// lib/server/admin.ts bootstraps with `if (getApps().length > 0) getApp()`,
// so any app existing first makes it reach for a default app that was never
// created. Worth keeping as a comment — it is a trap for the next test too.
const docs = () => adminDb().collection("documents");

const { serializeDocument } = await import("@/lib/server/publicDocument.ts");

/** A document in the state the argument describes, and its id. */
async function given(fields) {
  const ref = docs().doc();
  const payload = {
    orgId: "grime-busters",
    customerId: "cust-1",
    kind: "estimate",
    status: "sent",
    total: 24000,
    ...fields,
  };
  // An explicit undefined is rejected by Firestore, and "no status at all" is
  // a case worth testing — so undefined here means "leave the field off".
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) delete payload[key];
  }
  await ref.set(payload);
  return ref.id;
}

const read = async (id) => (await docs().doc(id).get()).data();

const MINUTE = 60 * 1000;

before(async () => {
  // Fail loudly rather than silently testing nothing if the emulator is not
  // actually reachable: a connection error from the Admin SDK otherwise looks
  // like a slow test.
  await docs().limit(1).get();
});

describe("the first time somebody opens it", () => {
  test("stamps first and last, and counts one", async () => {
    const id = await given({});
    const before = Date.now();
    assert.equal(await recordDocumentView(id), "first");

    const data = await read(id);
    assert.ok(data.firstViewedAt instanceof Timestamp, "firstViewedAt is a timestamp");
    assert.ok(data.lastViewedAt instanceof Timestamp, "lastViewedAt is a timestamp");
    assert.equal(data.viewCount, 1);
    // Same moment, not a stamp from somewhere else.
    assert.ok(data.firstViewedAt.toMillis() >= before - 1000);
    assert.equal(data.firstViewedAt.toMillis(), data.lastViewedAt.toMillis());
  });

  test("leaves everything else on the document alone", async () => {
    // A write that touched status would answer the quote on the customer's
    // behalf. It only ever adds the three fields.
    const id = await given({ total: 24000, status: "sent" });
    await recordDocumentView(id);
    const data = await read(id);
    assert.equal(data.status, "sent");
    assert.equal(data.total, 24000);
    assert.equal(data.customerId, "cust-1");
  });
});

describe("reading it again in the same sitting", () => {
  test("writes nothing at all", async () => {
    // A refresh, a back-then-forward, the round trip through Stripe. Counting
    // those as fresh opens turns one person reading into a story about
    // interest that never happened.
    const id = await given({});
    await recordDocumentView(id);
    const first = await read(id);

    assert.equal(await recordDocumentView(id), "same-visit");
    const second = await read(id);
    assert.equal(second.viewCount, 1, "no second count");
    assert.equal(
      second.lastViewedAt.toMillis(),
      first.lastViewedAt.toMillis(),
      "not even the clock moves",
    );
  });

  test("twenty-nine minutes later is still the same sitting", async () => {
    const id = await given({
      firstViewedAt: Timestamp.fromMillis(Date.now() - 29 * MINUTE),
      lastViewedAt: Timestamp.fromMillis(Date.now() - 29 * MINUTE),
      viewCount: 1,
    });
    assert.equal(await recordDocumentView(id), "same-visit");
    assert.equal((await read(id)).viewCount, 1);
  });
});

describe("coming back later", () => {
  test("thirty-one minutes later is a new visit", async () => {
    const wasFirst = Date.now() - 3 * 24 * 60 * MINUTE;
    const id = await given({
      firstViewedAt: Timestamp.fromMillis(wasFirst),
      lastViewedAt: Timestamp.fromMillis(Date.now() - 31 * MINUTE),
      viewCount: 1,
    });

    assert.equal(await recordDocumentView(id), "repeat");
    const data = await read(id);
    assert.equal(data.viewCount, 2);
    assert.equal(
      data.firstViewedAt.toMillis(),
      wasFirst,
      "when they FIRST looked must never move — that is the fact the board reads",
    );
    assert.ok(data.lastViewedAt.toMillis() > Date.now() - 30 * MINUTE, "last moved to now");
  });

  test("the thirty-minute line is where it says it is", async () => {
    // Just over, rather than a day later, so the boundary itself is pinned.
    const id = await given({
      firstViewedAt: Timestamp.fromMillis(Date.now() - 90 * MINUTE),
      lastViewedAt: Timestamp.fromMillis(Date.now() - (30 * MINUTE + 2000)),
      viewCount: 4,
    });
    assert.equal(await recordDocumentView(id), "repeat");
    assert.equal((await read(id)).viewCount, 5);
  });
});

describe("what is not a view", () => {
  test("a draft is refused, and nothing is written", async () => {
    // A draft has a share token as soon as anybody asks for one, and the
    // public page renders it. Stamping the crew's own look at a draft would
    // leave the board saying the customer read the estimate before it was
    // ever sent.
    const id = await given({ status: "draft" });
    assert.equal(await recordDocumentView(id), "not-sent");
    const data = await read(id);
    assert.equal(data.firstViewedAt, undefined);
    assert.equal(data.viewCount, undefined);
  });

  test("a void document is refused too", async () => {
    const id = await given({ status: "void" });
    assert.equal(await recordDocumentView(id), "not-sent");
    assert.equal((await read(id)).firstViewedAt, undefined);
  });

  test("a document with no status at all is refused", async () => {
    const id = await given({ status: undefined });
    assert.equal(await recordDocumentView(id), "not-sent");
  });

  test("a token for a document that is gone", async () => {
    assert.equal(await recordDocumentView("no-such-document"), "unknown-document");
  });
});

describe("statuses a view still means something on", () => {
  // A customer rereading an invoice they already paid, or an estimate they
  // accepted, is a real open worth seeing.
  for (const status of ["accepted", "declined", "partial", "paid"]) {
    test(`${status} is stamped`, async () => {
      const id = await given({ status });
      assert.equal(await recordDocumentView(id), "first");
      assert.equal((await read(id)).viewCount, 1);
    });
  }
});

describe("two opens landing at once", () => {
  test("one first, no double count, and the earlier stamp survives", async () => {
    // The case the transaction exists for: a customer taps the link twice, or
    // opens it on a phone and a laptop in the same second. Without the
    // transaction the second write moves firstViewedAt forward, and the record
    // says they first looked later than they did.
    const id = await given({});

    const outcomes = await Promise.all([
      recordDocumentView(id),
      recordDocumentView(id),
    ]);

    assert.equal(
      outcomes.filter((o) => o === "first").length,
      1,
      `exactly one open is the first one, got ${JSON.stringify(outcomes)}`,
    );
    const data = await read(id);
    assert.equal(data.viewCount, 1, "the pair counts once, not twice");
    assert.equal(data.firstViewedAt.toMillis(), data.lastViewedAt.toMillis());
  });

  test("five at once still count once", async () => {
    const id = await given({});
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => recordDocumentView(id)),
    );
    assert.equal(outcomes.filter((o) => o === "first").length, 1);
    assert.equal((await read(id)).viewCount, 1);
  });
});

describe("the stamps do not go back to the customer", () => {
  // SerialDocument omits the three fields at the type level, which proves
  // nothing at runtime — a serializer that spread the raw document would
  // satisfy the type and still ship the stamps to the person being counted.
  // So this runs it. (Imported at the top of the file: `describe` takes a
  // synchronous callback.)

  const snap = (fields) => ({
    exists: true,
    id: "doc-1",
    data: () => ({
      orgId: "grime-busters",
      number: "EST-1042",
      kind: "estimate",
      status: "sent",
      customerId: "cust-1",
      customerName: "Marta Reyes",
      serviceType: "lawn_care",
      lineItems: [],
      total: 24000,
      ...fields,
    }),
  });

  test("the view fields are absent from what the customer is served", () => {
    const out = serializeDocument(
      snap({
        firstViewedAt: Timestamp.fromMillis(Date.now() - 60000),
        lastViewedAt: Timestamp.now(),
        viewCount: 3,
      }),
    );
    assert.ok(out, "the document serialized");
    for (const field of ["firstViewedAt", "lastViewedAt", "viewCount"]) {
      assert.equal(field in out, false, `${field} must not be sent to the customer`);
    }
  });

  test("and the rest of the quote still arrives intact", () => {
    // So the test above cannot pass by the serializer returning nothing much.
    const out = serializeDocument(snap({ viewCount: 3 }));
    assert.equal(out.number, "EST-1042");
    assert.equal(out.total, 24000);
    assert.equal(out.customerName, "Marta Reyes");
  });
});
