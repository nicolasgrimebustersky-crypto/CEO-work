/**
 * The account portal's one promise: a customer sees their own documents and
 * nobody else's.
 *
 *   npm run test:api
 *
 * Runs against the server test-api.sh starts, with the Auth and Firestore
 * emulators. Two customers are seeded by email; a session for A is checked
 * against A's documents, B's documents, a made-up id, an unverified address,
 * and an address the CRM has never heard of.
 */
import assert from "node:assert/strict";
import { test, before, describe } from "node:test";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3399";
const AUTH_EMULATOR =
  process.env.TEST_AUTH_EMULATOR ??
  "http://127.0.0.1:9399/identitytoolkit.googleapis.com/v1";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8399";
const PROJECT = process.env.TEST_PROJECT ?? "demo-grimebusters-apitest";
const DOCS = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;

// The emulators treat "Bearer owner" as the project owner, which is how the
// seed data gets past the rules without a service account.
const OWNER = { Authorization: "Bearer owner", "Content-Type": "application/json" };

const A_EMAIL = "portal-a@example.com";
const B_EMAIL = "portal-b@example.com";
const NOBODY_EMAIL = "portal-nobody@example.com";
const PASSWORD = "portal-test-pass-1";

const str = (v) => ({ stringValue: v });
const num = (v) => ({ doubleValue: v });
const ts = (d) => ({ timestampValue: d.toISOString() });
const list = () => ({ arrayValue: { values: [] } });

async function seed(collection, id, fields) {
  const res = await fetch(`${DOCS}/${collection}?documentId=${id}`, {
    method: "POST",
    headers: OWNER,
    body: JSON.stringify({ fields }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`seed ${collection}/${id}: ${res.status} ${await res.text()}`);
}

async function signUp(email) {
  const res = await fetch(`${AUTH_EMULATOR}/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!res.ok && json?.error?.message !== "EMAIL_EXISTS") throw new Error(`signUp ${email}: ${JSON.stringify(json)}`);
  const login = await fetch(`${AUTH_EMULATOR}/accounts:signInWithPassword?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const data = await login.json();
  return { idToken: data.idToken, localId: data.localId };
}

async function verifiedToken(email) {
  const { localId } = await signUp(email);
  const res = await fetch(`${AUTH_EMULATOR}/accounts:update`, {
    method: "POST",
    headers: OWNER,
    body: JSON.stringify({ localId, emailVerified: true }),
  });
  if (!res.ok) throw new Error(`could not mark ${email} verified: ${res.status} ${await res.text()}`);
  return (await signUp(email)).idToken; // a fresh token that carries email_verified
}

async function call(path, token, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Origin: "https://grimebusterskyllc.com",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { status: res.status, cors: res.headers.get("access-control-allow-origin"), body: await res.json().catch(() => null) };
}

const now = new Date();
const inDays = (n) => new Date(now.getTime() + n * 86_400_000);

let tokenA, tokenAUnverified, tokenNobody;

before(async () => {
  await seed("customers", "portal_cust_a", { firstName: str("Ada"), lastName: str("Portal"), email: str(A_EMAIL), phone: str("5025550101"), address: str("1 Test St"), status: str("customer"), pipelineStage: str("paid"), lat: num(38.2), lng: num(-85.7), notes: list(), tags: list(), serviceTypes: list() });
  await seed("customers", "portal_cust_b", { firstName: str("Bo"), lastName: str("Other"), email: str(B_EMAIL), phone: str("5025550102"), address: str("2 Test St"), status: str("customer"), pipelineStage: str("paid"), lat: num(38.2), lng: num(-85.7), notes: list(), tags: list(), serviceTypes: list() });
  const doc = (customerId, number, kind, status) => ({ customerId: str(customerId), customerName: str("x"), number: str(number), kind: str(kind), status: str(status), serviceType: str("pressure_washing"), lineItems: list(), payments: list(), discount: num(0), taxRatePct: num(6), subtotal: num(100), taxAmount: num(6), total: num(106), amountPaid: num(0), balanceDue: num(106), createdAt: ts(now), shareToken: str("tok_" + number) });
  await seed("documents", "portal_doc_a_est", doc("portal_cust_a", "E-9001", "estimate", "sent"));
  await seed("documents", "portal_doc_a_inv", doc("portal_cust_a", "I-9002", "invoice", "sent"));
  await seed("documents", "portal_doc_a_void", doc("portal_cust_a", "I-9003", "invoice", "void"));
  await seed("documents", "portal_doc_b_est", doc("portal_cust_b", "E-9101", "estimate", "sent"));
  await seed("jobs", "portal_job_a_future", { customerId: str("portal_cust_a"), serviceType: str("pressure_washing"), status: str("scheduled"), price: num(106), assignedTo: list(), scheduledStart: ts(inDays(3)), scheduledEnd: ts(inDays(3)) });
  await seed("jobs", "portal_job_a_past", { customerId: str("portal_cust_a"), serviceType: str("pressure_washing"), status: str("complete"), price: num(106), assignedTo: list(), scheduledStart: ts(inDays(-30)), scheduledEnd: ts(inDays(-30)) });
  await seed("jobs", "portal_job_b_future", { customerId: str("portal_cust_b"), serviceType: str("landscaping"), status: str("scheduled"), price: num(50), assignedTo: list(), scheduledStart: ts(inDays(2)), scheduledEnd: ts(inDays(2)) });

  tokenA = await verifiedToken(A_EMAIL);
  tokenAUnverified = (await signUp("portal-a-unverified@example.com")).idToken;
  tokenNobody = await verifiedToken(NOBODY_EMAIL);
});

describe("portal: who gets in", () => {
  test("no token is 401", async () => {
    const r = await call("/api/portal/documents", null);
    assert.equal(r.status, 401);
  });
  test("an unverified address proves nothing and is refused", async () => {
    // The security property, unchanged: signing up with somebody's address and
    // never opening the mail must not reach their records. Only the wording
    // moved — sign-in now accepts a texted code as well, so a message telling
    // everybody to use "the link we emailed" would be wrong for most callers.
    const r = await call("/api/portal/documents", tokenAUnverified);
    assert.equal(r.status, 403);
    assert.match(r.body.error, /confirm your phone number or email/i);
  });
  test("a verified address with no customer record is told so, readably, cross-origin", async () => {
    const r = await call("/api/portal/documents", tokenNobody);
    assert.equal(r.status, 404);
    // Names both identifiers now, and offers the claim route as a way forward
    // rather than only a phone number.
    assert.match(r.body.error, /records under that phone number or email/i);
    assert.match(r.body.error, /estimate or invoice number/i);
    assert.equal(r.cors, "https://grimebusterskyllc.com");
  });
  test("preflight from the marketing site is allowed", async () => {
    const res = await fetch(`${BASE}/api/portal/documents`, { method: "OPTIONS", headers: { Origin: "https://grimebusterskyllc.com", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "https://grimebusterskyllc.com");
  });
});

describe("portal: what a customer sees", () => {
  test("A sees A's live documents, not B's, not the voided one, and never a share token", async () => {
    const r = await call("/api/portal/documents", tokenA);
    assert.equal(r.status, 200);
    const numbers = r.body.documents.map((d) => d.number).sort();
    assert.deepEqual(numbers, ["E-9001", "I-9002"]);
    assert.ok(r.body.documents.every((d) => d.shareToken === null));
    assert.equal(r.body.customers[0].email, A_EMAIL);
  });
  test("A can open A's document", async () => {
    const r = await call("/api/portal/documents/portal_doc_a_inv", tokenA);
    assert.equal(r.status, 200);
    assert.equal(r.body.document.number, "I-9002");
    assert.equal(r.body.document.shareToken, null);
  });
  test("A cannot open B's document, and gets the same answer as for a made-up id", async () => {
    const theirs = await call("/api/portal/documents/portal_doc_b_est", tokenA);
    const nothing = await call("/api/portal/documents/does_not_exist", tokenA);
    assert.equal(theirs.status, 404);
    assert.equal(nothing.status, 404);
    assert.equal(theirs.body.error, nothing.body.error);
  });
  test("A sees only A's upcoming job", async () => {
    const r = await call("/api/portal/jobs", tokenA);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.jobs.map((j) => j.id), ["portal_job_a_future"]);
    assert.equal(r.body.jobs[0].price, undefined);
  });
});

describe("portal: answering an estimate", () => {
  test("A cannot answer B's estimate", async () => {
    const r = await call("/api/portal/documents/portal_doc_b_est", tokenA, { method: "POST", body: JSON.stringify({ decision: "declined", message: "no" }) });
    assert.equal(r.status, 404);
  });
  test("A can decline A's estimate, and the list reflects it", async () => {
    const r = await call("/api/portal/documents/portal_doc_a_est", tokenA, { method: "POST", body: JSON.stringify({ decision: "declined", message: "Not this month." }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.decision, "declined");
    const after = await call("/api/portal/documents/portal_doc_a_est", tokenA);
    assert.equal(after.body.document.status, "declined");
  });
  test("an answered estimate cannot be answered again", async () => {
    const r = await call("/api/portal/documents/portal_doc_a_est", tokenA, { method: "POST", body: JSON.stringify({ decision: "accepted" }) });
    assert.equal(r.status, 409);
  });
});
