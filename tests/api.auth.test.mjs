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

let crewToken;
let outsiderToken;

async function idToken(email, password) {
  for (const path of ["accounts:signInWithPassword", "accounts:signUp"]) {
    const res = await fetch(`${AUTH_EMULATOR}/${path}?key=fake-api-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    if (res.ok) return (await res.json()).idToken;
  }
  throw new Error(`could not get a token for ${email}`);
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
  crewToken = await idToken("nick@grimebusters.test", "test1234");
  outsiderToken = await idToken("mallory@example.test", "test1234");
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

describe("GET /api/cron/quote-followups", () => {
  test("rejects a missing or wrong secret", async () => {
    assert.equal((await fetch(`${BASE}/api/cron/quote-followups`)).status, 401);
    assert.equal(
      (
        await fetch(`${BASE}/api/cron/quote-followups`, {
          headers: { Authorization: "Bearer wrong-secret" },
        })
      ).status,
      401,
    );
  });

  test("does not accept a crew ID token in place of the cron secret", async () => {
    // Different trust domains: a user session must not be able to trigger the
    // automated sender.
    const res = await fetch(`${BASE}/api/cron/quote-followups`, {
      headers: { Authorization: `Bearer ${crewToken}` },
    });
    assert.equal(res.status, 401);
  });

  test("accepts the correct secret", async () => {
    const res = await fetch(`${BASE}/api/cron/quote-followups`, {
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
