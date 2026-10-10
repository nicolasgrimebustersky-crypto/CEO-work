/**
 * Auth and rate-limit tests for the API routes.
 *
 *   npm run test:api
 *
 * These routes run with the Firebase Admin SDK, which bypasses Firestore
 * security rules completely. That makes them the softest part of the app: the
 * rules tests prove nothing about them. Everything here is about the two gates
 * that do apply — the crew allowlist and the spend ceiling.
 *
 * The runner script (scripts/test-api.sh) boots the emulators, seeds two crew
 * accounts, starts the production server wired to them, and sets deliberately
 * fake Twilio credentials so the routes get past their config check and reach
 * the logic under test without any message actually being sent.
 */
import assert from "node:assert/strict";
import { test, before, describe } from "node:test";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3133";
const AUTH_EMULATOR =
  process.env.TEST_AUTH_EMULATOR ?? "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const CRON_SECRET = process.env.CRON_SECRET ?? "test-cron-secret";

const SECURE_TOKEN = `${AUTH_EMULATOR.replace(/\/identitytoolkit\.googleapis\.com\/v1$/, "")}/securetoken.googleapis.com/v1`;

let crewToken;
/** The same crew account, before its sign-in has entered a code. */
let freshCrewToken;
let outsiderToken;

async function session(email, password) {
  for (const path of ["accounts:signInWithPassword", "accounts:signUp"]) {
    const res = await fetch(`${AUTH_EMULATOR}/${path}?key=fake-api-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    if (res.ok) return res.json();
  }
  throw new Error(`could not get a token for ${email}`);
}

async function idToken(email, password) {
  return (await session(email, password)).idToken;
}

function authTimeOf(token) {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  return payload.auth_time;
}

/**
 * Marks a sign-in as having entered its code, the way the server does after
 * /api/otp/verify: the session's auth_time goes into the account's `otpAuths`
 * claim, and a fresh token is minted so the claim is actually in hand.
 *
 * Done through the emulator's admin endpoint rather than the route, because
 * the route emails the code and there is no mail here to read it from. What
 * this proves is the same thing the rules tests prove from the other side:
 * with the claim, everything works; without it, nothing does.
 */
async function verifiedToken(email, password) {
  const fresh = await session(email, password);
  const update = await fetch(`${AUTH_EMULATOR}/accounts:update?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({
      localId: fresh.localId,
      customAttributes: JSON.stringify({ otpAuths: [authTimeOf(fresh.idToken)] }),
    }),
  });
  if (!update.ok) throw new Error(`could not set the claim: ${await update.text()}`);

  const refreshed = await fetch(`${SECURE_TOKEN}/token?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(fresh.refreshToken)}`,
  });
  if (!refreshed.ok) throw new Error(`could not refresh: ${await refreshed.text()}`);
  return { verified: (await refreshed.json()).id_token, fresh: fresh.idToken };
}

async function post(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

before(async () => {
  const nick = await verifiedToken("nick@grimebusters.test", "test1234");
  crewToken = nick.verified;
  freshCrewToken = nick.fresh;
  outsiderToken = await idToken("mallory@example.test", "test1234");
});

describe("the sign-in code", () => {
  test("a crew session that has not entered its code is refused everywhere", async () => {
    // Real account, real signature, on the allowlist — and still no. The
    // Admin SDK bypasses the Firestore rules, so this check in requireCrew()
    // is the only thing standing between a stolen password and every route.
    const res = await post("/api/sms/send", { customerId: "cust-oak", body: "hi" }, freshCrewToken);
    assert.equal(res.status, 403);
    assert.match(res.json.error, /code/i);
  });

  test("but may ask for a code, and is told plainly when mail is not set up", async () => {
    // Past the crew check (not 401/403). No Resend key on the test server,
    // and the answer names the variable rather than blaming the login.
    const res = await post("/api/otp/send", {}, freshCrewToken);
    assert.equal(res.status, 503);
    assert.match(res.json.error, /RESEND_API_KEY/);
  });

  test("and may try a code, which is checked rather than assumed", async () => {
    const res = await post("/api/otp/verify", { code: "000000" }, freshCrewToken);
    assert.equal(res.status, 400);
  });

  test("a half-typed code is refused before anything is looked up", async () => {
    const res = await post("/api/otp/verify", { code: "12" }, freshCrewToken);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /six/i);
  });

  test("an outsider cannot even ask for a code", async () => {
    assert.equal((await post("/api/otp/send", {}, outsiderToken)).status, 403);
    assert.equal((await post("/api/otp/verify", { code: "123456" }, outsiderToken)).status, 403);
    assert.equal((await post("/api/otp/send", {})).status, 401);
  });
});

describe("POST /api/sms/send", () => {
  const payload = { customerId: "cust-oak", body: "test message" };

  test("rejects a request with no token", async () => {
    assert.equal((await post("/api/sms/send", payload)).status, 401);
  });

  test("rejects a bogus token", async () => {
    assert.equal((await post("/api/sms/send", payload, "not-a-token")).status, 401);
  });

  test("rejects a valid token that is not on the crew allowlist", async () => {
    // The important case: real Firebase account, real signature, wrong person.
    assert.equal((await post("/api/sms/send", payload, outsiderToken)).status, 403);
  });

  test("rejects malformed requests from an authorised caller", async () => {
    assert.equal((await post("/api/sms/send", { body: "hi" }, crewToken)).status, 400);
    assert.equal(
      (await post("/api/sms/send", { customerId: "cust-oak", body: "" }, crewToken)).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/api/sms/send",
          { customerId: "cust-oak", body: "x".repeat(1700) },
          crewToken,
        )
      ).status,
      400,
    );
  });

  test("rejects an unknown customer", async () => {
    assert.equal(
      (await post("/api/sms/send", { customerId: "nope", body: "hi" }, crewToken)).status,
      404,
    );
  });
});

describe("POST /api/sms/blast", () => {
  test("rejects unauthenticated and non-crew callers", async () => {
    const payload = { customerIds: ["cust-oak"], body: "hi" };
    assert.equal((await post("/api/sms/blast", payload)).status, 401);
    assert.equal((await post("/api/sms/blast", payload, outsiderToken)).status, 403);
  });

  test("rejects an empty recipient list", async () => {
    assert.equal(
      (await post("/api/sms/blast", { customerIds: [], body: "hi" }, crewToken)).status,
      400,
    );
  });

  test("refuses a blast over the 200-recipient cap", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => `c${i}`);
    const res = await post("/api/sms/blast", { customerIds: tooMany, body: "hi" }, crewToken);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /200 limit/);
  });

  test("stops a runaway caller at the hourly ceiling", async () => {
    // A session that passes requireCrew() has proved who it is, not how much it
    // may spend. Four blasts an hour is the ceiling; the fifth must be refused
    // even though it is perfectly authenticated.
    const payload = { customerIds: ["cust-oak"], body: "rate limit probe" };
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await post("/api/sms/blast", payload, crewToken)).status);
    }

    const refused = statuses.filter((s) => s === 429);
    assert.ok(
      refused.length >= 1,
      `expected at least one 429 within 5 blasts, saw ${statuses.join(",")}`,
    );
    // And it must be the tail, not the head — the first calls have to work.
    assert.notEqual(statuses[0], 429, "the first blast should not be rate limited");
  });
});

describe("GET /api/cron/lead-nurture", () => {
  test("rejects a missing or wrong secret", async () => {
    assert.equal((await fetch(`${BASE}/api/cron/lead-nurture`)).status, 401);
    assert.equal(
      (
        await fetch(`${BASE}/api/cron/lead-nurture`, {
          headers: { Authorization: "Bearer wrong-secret" },
        })
      ).status,
      401,
    );
  });

  test("does not accept a crew ID token in place of the cron secret", async () => {
    // Different trust domains: a user session must not be able to trigger the
    // automated sender.
    const res = await fetch(`${BASE}/api/cron/lead-nurture`, {
      headers: { Authorization: `Bearer ${crewToken}` },
    });
    assert.equal(res.status, 401);
  });

  test("accepts the correct secret", async () => {
    const res = await fetch(`${BASE}/api/cron/lead-nurture`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    assert.equal(res.status, 200);
  });
});

describe("POST /api/sms/inbound", () => {
  test("rejects an unsigned webhook", async () => {
    // Without signature checking, anyone who guessed this URL could write
    // arbitrary notes into a customer's timeline.
    const res = await fetch(`${BASE}/api/sms/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: "+15025550100", Body: "forged" }).toString(),
    });
    assert.equal(res.status, 403);
  });

  test("rejects a webhook with a wrong signature", async () => {
    const res = await fetch(`${BASE}/api/sms/inbound`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": "obviously-not-valid",
      },
      body: new URLSearchParams({ From: "+15025550100", Body: "forged" }).toString(),
    });
    assert.equal(res.status, 403);
  });
});

describe("/api/sms/test", () => {
  async function get(token) {
    const res = await fetch(`${BASE}/api/sms/test`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, text: await res.text() };
  }

  test("the status read is behind the same gate as everything else", async () => {
    assert.equal((await get()).status, 401);
    assert.equal((await get(outsiderToken)).status, 403);
  });

  test("reports what is configured without printing any of it", async () => {
    const { status, text } = await get(crewToken);
    assert.equal(status, 200);

    const body = JSON.parse(text);
    assert.equal(body.canSend, true, "the runner sets fake but complete credentials");
    assert.equal(body.kind, "auth-token");

    // The whole point of the screen is to say what is set, which is one slip
    // away from saying what it is set *to*. The runner's auth token is
    // "faketoken"; if it ever appears in this response, a browser has been
    // handed a sending credential.
    assert.ok(!text.includes("faketoken"), "the auth token must never be returned");
  });

  test("sends to the caller's own number, never one from the request", async () => {
    // An endpoint that texts whatever number it is given is an open SMS relay
    // wearing a test label. The destination is read from the profile on the
    // server, so this injected number must be ignored outright.
    const { status, json } = await post(
      "/api/sms/test",
      { to: "+15558675309", phone: "+15558675309" },
      crewToken,
    );
    assert.equal(status, 200);
    // Nick's seeded profile number is 502-555-0147.
    assert.equal(json.tail, "0147");
    // Twilio itself rejects the fake credentials, and that is reported rather
    // than thrown — the error is the answer the button exists to give.
    assert.equal(json.sent, false);
    assert.ok(json.error, "a failed send must say why");
  });

  test("refuses an outsider a test text too", async () => {
    assert.equal((await post("/api/sms/test", {}, outsiderToken)).status, 403);
  });
});

describe("security headers", () => {
  test("every response carries the hardening headers", async () => {
    const res = await fetch(`${BASE}/map`);
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("strict-transport-security") ?? "", /max-age=\d{7,}/);
    assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/);
    // Framework fingerprinting is off.
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  test("API responses are never cached", async () => {
    const res = await fetch(`${BASE}/api/sms/send`, { method: "POST" });
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  });
});

/**
 * The one route a stranger is supposed to be able to POST to.
 *
 * Everything else here is about keeping people out. This one is open by
 * design — a customer opening their quote has no account — so what matters is
 * the opposite question: that being open costs nothing. It must never say
 * anything back, never need a login, and never let the caller choose what it
 * writes.
 *
 * What the write does to the document is tested against the emulator in
 * tests/documentViews.server.test.mjs. This is about the reply.
 */
describe("the quote-viewed beacon", () => {
  const PROJECT = process.env.TEST_PROJECT ?? "demo-grimebusters-apitest";
  let db;
  let token;
  let documentId;

  before(async () => {
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    // No credential: against the emulator the Admin SDK does not need one.
    const app = getApps().find((a) => a.name === "viewed-route-test")
      ?? initializeApp({ projectId: PROJECT }, "viewed-route-test");
    db = getFirestore(app);

    token = `viewtest-${Date.now()}`;
    const ref = db.collection("documents").doc();
    await ref.set({
      orgId: "grime-busters",
      customerId: "cust-viewed",
      customerName: "Marta Reyes",
      kind: "estimate",
      number: "EST-9001",
      status: "sent",
      serviceType: "lawn_care",
      lineItems: [],
      total: 18000,
      shareToken: token,
    });
    documentId = ref.id;
  });

  const post = (t) =>
    fetch(`${BASE}/api/quote/${encodeURIComponent(t)}/viewed`, { method: "POST" });

  test("an unauthenticated open is accepted and answered with nothing", async () => {
    const res = await post(token);
    assert.equal(res.status, 204, "no login, no 401 — a customer has no account");
    assert.equal(await res.text(), "", "and a bare body");
  });

  test("and the stamp actually landed", async () => {
    // So the 204 above cannot pass by the route doing nothing at all.
    const data = (await db.collection("documents").doc(documentId).get()).data();
    assert.ok(data.firstViewedAt, "firstViewedAt was written");
    assert.equal(data.viewCount, 1);
  });

  test("an unknown token gets the identical answer", async () => {
    // A different reply would confirm to somebody walking tokens which ones
    // are real. Same status, same empty body.
    const res = await post("definitely-not-a-real-share-token");
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
  });

  test("a draft's token gets the identical answer too", async () => {
    const ref = db.collection("documents").doc();
    const draftToken = `viewtest-draft-${Date.now()}`;
    await ref.set({
      orgId: "grime-busters",
      customerId: "cust-viewed",
      kind: "estimate",
      status: "draft",
      total: 1000,
      shareToken: draftToken,
    });

    const res = await post(draftToken);
    assert.equal(res.status, 204, "the caller is told nothing either way");
    assert.equal(await res.text(), "");
    const data = (await ref.get()).data();
    assert.equal(data.firstViewedAt, undefined, "and a draft is still not stamped");
  });

  test("a GET does not stamp anything", async () => {
    // A GET is what a crawler or a link prefetcher issues.
    const ref = db.collection("documents").doc();
    const getToken = `viewtest-get-${Date.now()}`;
    await ref.set({
      orgId: "grime-busters",
      customerId: "cust-viewed",
      kind: "estimate",
      status: "sent",
      total: 1000,
      shareToken: getToken,
    });

    const res = await fetch(`${BASE}/api/quote/${encodeURIComponent(getToken)}/viewed`);
    assert.notEqual(res.status, 204, "there is no GET handler to answer it");
    assert.equal((await ref.get()).data().firstViewedAt, undefined, "nothing was written");
  });

  test("hammering one quote's link cannot inflate the count", async () => {
    // A leaked link must not be usable to turn one open into a story about
    // interest that never happened.
    //
    // Two things stop it and only one is visible from out here: the
    // same-visit window means a reload writes nothing at all, so the count
    // stays at one however many times the link is hit. The per-document rate
    // limit behind it is a second line, and it is deliberately invisible —
    // every reply is a 204 whether or not the budget is spent, so there is
    // nothing here to measure it by. That one is checked by its own test in
    // tests/documentViews.test.mjs.
    const ref = db.collection("documents").doc();
    const hotToken = `viewtest-rate-${Date.now()}`;
    await ref.set({
      orgId: "grime-busters",
      customerId: "cust-viewed",
      kind: "estimate",
      status: "sent",
      total: 1000,
      shareToken: hotToken,
    });

    for (let i = 0; i < 24; i += 1) {
      const res = await post(hotToken);
      assert.equal(res.status, 204, `request ${i + 1} still answers with nothing`);
    }
    const data = (await ref.get()).data();
    assert.equal(
      data.viewCount,
      1,
      `twenty-four hits on one link is one open, saw ${data.viewCount}`,
    );
  });
});
