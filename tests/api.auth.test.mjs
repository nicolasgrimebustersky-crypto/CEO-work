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
