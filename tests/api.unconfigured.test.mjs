/**
 * What a half-configured deployment tells you.
 *
 *   npm run test:api
 *
 * Run against a second server started with no FIREBASE_SERVICE_ACCOUNT_KEY —
 * the state a deployment is in when somebody has set every Twilio variable and
 * forgotten this one.
 *
 * The failure it guards is not a crash. Without the service account the Admin
 * SDK throws on its first call, and if that throw is caught alongside a genuine
 * bad-token error, the operator is told their session expired. They then sign
 * out, sign back in, get the same message, and go looking at Firebase Auth —
 * which is working fine. The variable they actually need is never mentioned.
 * The whole point of these assertions is the wording, not the status code.
 */
import assert from "node:assert/strict";
import { test, before, describe } from "node:test";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3400";
const AUTH_EMULATOR =
  process.env.TEST_AUTH_EMULATOR ??
  "http://127.0.0.1:9399/identitytoolkit.googleapis.com/v1";

let crewToken;

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

async function call(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

before(async () => {
  crewToken = await idToken("nick@grimebusters.test", "test1234");
});

describe("a deployment with no service account", () => {
  test("says which variable is missing, to somebody holding a good token", async () => {
    const { status, json } = await call("/api/sms/test", crewToken);
    assert.equal(status, 503, `got ${status}: ${JSON.stringify(json)}`);
    assert.match(json.error ?? "", /FIREBASE_SERVICE_ACCOUNT_KEY/);
  });

  test("does not blame the caller's login", async () => {
    // The regression in one line. This token is valid; saying it expired sends
    // whoever deployed the app to the wrong place entirely.
    const { json } = await call("/api/sms/test", crewToken);
    assert.doesNotMatch(json.error ?? "", /expired/i);
    assert.match(json.error ?? "", /nothing is wrong with your login/i);
  });

  test("503, not 401 — the server is at fault, not the request", async () => {
    // A 401 invites a client to go and re-authenticate, which will not help and
    // can loop. 503 says the service is not ready.
    const { status } = await call("/api/sms/test", crewToken);
    assert.notEqual(status, 401);
  });

  test("a request with no token at all is still refused first", async () => {
    // Ordering matters: the missing-variable message is more specific and more
    // useful, but it must not become a way to learn about the deployment
    // without presenting any credential.
    const { status, json } = await call("/api/sms/test");
    assert.equal(status, 401);
    assert.doesNotMatch(json.error ?? "", /FIREBASE_SERVICE_ACCOUNT_KEY/);
  });
});
