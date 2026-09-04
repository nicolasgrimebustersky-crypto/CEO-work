/**
 * The customer's link, against a running server.
 *
 * The claim this file exists to check is that a stranger with the link sees
 * the quote and a stranger without it sees nothing. That cannot be tested from
 * the inside: the page is a server component reading through the Admin SDK,
 * the auth wall is a client component, and the interesting failure is the two
 * of them disagreeing. So this fetches real URLs with no credentials at all —
 * no cookie, no token, nothing — which is exactly what a customer's phone
 * sends.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, before, describe } from "node:test";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3399";
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8399";
const PROJECT = process.env.TEST_PROJECT ?? "demo-grimebusters-apitest";

/** A token shaped exactly as lib/db/documents.ts mints one in the browser. */
function mintToken() {
  return randomBytes(24).toString("base64url");
}

const OWNER = { Authorization: "Bearer owner", "Content-Type": "application/json" };

async function writeDoc(collection, id, fields) {
  const res = await fetch(
    `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}?documentId=${id}`,
    { method: "POST", headers: OWNER, body: JSON.stringify({ fields }) },
  );
  assert.ok(res.ok, `seeding ${collection}/${id} failed: ${res.status} ${await res.text()}`);
}

const CUSTOMER_ID = `share-cust-${Date.now()}`;
const SURNAME = `Testerson${Date.now()}`;
const shared = mintToken();
const voided = mintToken();
const unshared = mintToken();
const toApprove = mintToken();
const toDecline = mintToken();
const alreadyDone = mintToken();

async function seedDocument(id, token, status) {
  await writeDoc("documents", id, {
    number: { stringValue: "E-9001" },
    kind: { stringValue: "estimate" },
    status: { stringValue: status },
    customerId: { stringValue: CUSTOMER_ID },
    customerName: { stringValue: `Ada ${SURNAME}` },
    serviceType: { stringValue: "pressure_washing" },
    lineItems: {
      arrayValue: {
        values: [
          {
            mapValue: {
              fields: {
                name: { stringValue: "Driveway wash" },
                description: { stringValue: "" },
                quantity: { doubleValue: 1 },
                unitPrice: { doubleValue: 450 },
                discountPct: { doubleValue: 0 },
              },
            },
          },
        ],
      },
    },
    payments: { arrayValue: { values: [] } },
    discount: { doubleValue: 0 },
    taxRatePct: { doubleValue: 6 },
    subtotal: { doubleValue: 450 },
    taxAmount: { doubleValue: 27 },
    total: { doubleValue: 477 },
    amountPaid: { doubleValue: 0 },
    balanceDue: { doubleValue: 477 },
    notes: { stringValue: "" },
    issuedAt: { timestampValue: new Date().toISOString() },
    createdAt: { timestampValue: new Date().toISOString() },
    createdByName: { stringValue: "test" },
    ...(token ? { shareToken: { stringValue: token } } : {}),
  });
}

before(async () => {
  await writeDoc("customers", CUSTOMER_ID, {
    firstName: { stringValue: "Ada" },
    lastName: { stringValue: SURNAME },
    phone: { stringValue: "+15025550188" },
    email: { stringValue: "" },
    address: { stringValue: "12 Oldham Lane" },
    // Deliberately present, and deliberately never printed. If this string
    // shows up on the page, the customer record is being passed through whole.
    notes: { stringValue: "INTERNAL-ONLY-NOTE-DO-NOT-PRINT" },
    doNotKnock: { booleanValue: true },
  });
  await seedDocument(`share-doc-${Date.now()}`, shared, "sent");
  await seedDocument(`share-yes-${Date.now()}`, toApprove, "sent");
  await seedDocument(`share-no-${Date.now()}`, toDecline, "sent");
  await seedDocument(`share-done-${Date.now()}`, alreadyDone, "accepted");
  await seedDocument(`share-void-${Date.now()}`, voided, "void");
  await seedDocument(`share-none-${Date.now()}`, null, "sent");
});

describe("the customer's link", () => {
  test("opens the quote with no credentials at all", async () => {
    const res = await fetch(`${BASE}/v/${shared}`, { redirect: "manual" });
    assert.equal(res.status, 200, "a holder of the link was not shown the document");
    const html = await res.text();

    // The customer's own details, which is how we know it resolved the right
    // document rather than rendering an empty shell.
    assert.ok(html.includes(SURNAME), "the customer's name is missing");
    assert.ok(html.includes("Driveway wash"), "the line item is missing");
    assert.ok(html.includes("477"), "the total is missing");

    // And no sign of the login wall. This is the whole point: AuthGate wraps
    // every route from the root layout, so a public page is one allowlist
    // entry away from being a sign-in screen instead.
    assert.ok(!/Sign in|Create account|Password/i.test(html), "a login wall was rendered");
  });

  test("does not leak the parts of the customer record it was never meant to show", async () => {
    const html = await fetch(`${BASE}/v/${shared}`).then((r) => r.text());
    assert.ok(
      !html.includes("INTERNAL-ONLY-NOTE-DO-NOT-PRINT"),
      "an internal note reached a page anyone with the link can open",
    );
    assert.ok(!/doNotKnock/i.test(html), "a do-not-knock flag reached the customer's page");
  });

  test("a made-up token is a 404", async () => {
    const res = await fetch(`${BASE}/v/${mintToken()}`, { redirect: "manual" });
    assert.equal(res.status, 404);
  });

  test("a document nobody shared cannot be reached by guessing a token", async () => {
    const res = await fetch(`${BASE}/v/${unshared}`, { redirect: "manual" });
    assert.equal(res.status, 404, "an unshared document was reachable");
  });

  test("a voided quote stops answering", async () => {
    // The link keeps working for everything else so a customer can re-read what
    // they agreed to, but a void document must stop stating a price.
    const res = await fetch(`${BASE}/v/${voided}`, { redirect: "manual" });
    assert.equal(res.status, 404);
  });

  test("junk in the path is refused without a database read", async () => {
    // Dot segments are deliberately absent, in both spellings: fetch and Next
    // normalise ".." — and "%2e%2e", which decodes to it — away before routing,
    // so /v/.. is a request for / and never reaches this page. Asserting a 404
    // there would be testing the URL parser rather than the guard, and would
    // pass for a reason that has nothing to do with this code.
    for (const junk of ["favicon.ico", "robots.txt", "x", "null", "undefined", "1"]) {
      const res = await fetch(`${BASE}/v/${junk}`, { redirect: "manual" });
      assert.equal(res.status, 404, `/v/${junk} did not 404`);
    }
  });

  test("the page tells crawlers to stay away", async () => {
    const html = await fetch(`${BASE}/v/${shared}`).then((r) => r.text());
    assert.match(html, /noindex/i, "the page is missing its noindex robots directive");
  });
});

/** A 1x1 PNG, which is all the validator cares about. */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function tomorrow() {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

async function respond(token, payload) {
  const res = await fetch(`${BASE}/api/quote/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function findByToken(token) {
  const res = await fetch(
    `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: OWNER,
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "documents" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "shareToken" },
              op: "EQUAL",
              value: { stringValue: token },
            },
          },
          limit: 1,
        },
      }),
    },
  );
  const rows = await res.json();
  const hit = rows.find((row) => row.document);
  return hit ? hit.document : null;
}

describe("answering the quote", () => {
  test("approving writes the signature, the date and the status back to the CRM", async () => {
    const out = await respond(toApprove, {
      decision: "accepted",
      signedName: "Ada Lovelace",
      signature: PNG,
      requestedDate: tomorrow(),
      message: "Gate code 1234",
    });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.decision, "accepted");

    const doc = await findByToken(toApprove);
    assert.ok(doc, "the document vanished");
    assert.equal(doc.fields.status.stringValue, "accepted", "status did not move to accepted");

    const acceptance = doc.fields.acceptance.mapValue.fields;
    assert.equal(acceptance.signedName.stringValue, "Ada Lovelace");
    assert.equal(acceptance.signature.stringValue, PNG, "the signature was not stored");
    assert.equal(acceptance.requestedDate.stringValue, tomorrow());
    assert.equal(acceptance.message.stringValue, "Gate code 1234");
    assert.ok(acceptance.acceptedAt.timestampValue, "no time was recorded");

    // Attribution is the point of a signature: this must not read as though a
    // crew member marked it accepted.
    assert.equal(doc.fields.updatedByName.stringValue, "Ada Lovelace");
  });

  test("the approval lands on the customer's timeline", async () => {
    const res = await fetch(
      `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/customers/${CUSTOMER_ID}`,
      { headers: OWNER },
    );
    const notes = (await res.json()).fields.notes.arrayValue.values ?? [];
    const text = notes.map((n) => n.mapValue.fields.text.stringValue).join("\n");
    assert.match(text, /Approved/, "nothing about the approval reached the timeline");
    assert.match(text, /Ada Lovelace/);
  });

  test("declining records the question and moves the status", async () => {
    const out = await respond(toDecline, {
      decision: "declined",
      message: "Is the back patio included at that price?",
    });
    assert.equal(out.status, 200, JSON.stringify(out.body));

    const doc = await findByToken(toDecline);
    assert.equal(doc.fields.status.stringValue, "declined");
    assert.match(
      doc.fields.decline.mapValue.fields.message.stringValue,
      /back patio/,
    );
  });

  test("a quote already answered cannot be answered again", async () => {
    // The link keeps working — a customer may re-read what they agreed to —
    // but a second tap must not silently overwrite the first decision.
    const out = await respond(alreadyDone, {
      decision: "declined",
      message: "changed my mind",
    });
    assert.equal(out.status, 409);
    assert.match(out.body.error, /already/i);
  });

  test("approving without a signature is refused", async () => {
    const out = await respond(shared, {
      decision: "accepted",
      signedName: "Ada",
      requestedDate: tomorrow(),
    });
    assert.equal(out.status, 400);
    assert.match(out.body.error, /signature/i);
  });

  test("a past date is refused", async () => {
    const out = await respond(shared, {
      decision: "accepted",
      signedName: "Ada",
      signature: PNG,
      requestedDate: "2020-01-01",
    });
    assert.equal(out.status, 400);
    assert.match(out.body.error, /date/i);
  });

  test("an SVG signature is refused", async () => {
    // It would be a script rendered on the crew's own screen.
    const out = await respond(shared, {
      decision: "accepted",
      signedName: "Ada",
      signature: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      requestedDate: tomorrow(),
    });
    assert.equal(out.status, 400);
    assert.match(out.body.error, /signature/i);
  });

  test("a made-up token cannot answer anything", async () => {
    const out = await respond(mintToken(), { decision: "accepted" });
    assert.equal(out.status, 404);
  });

  test("an unshared document cannot be answered", async () => {
    const out = await respond(unshared, { decision: "declined" });
    assert.equal(out.status, 404);
  });
});
