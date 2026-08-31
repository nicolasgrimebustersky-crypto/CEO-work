/**
 * The MCP endpoint, against a running server.
 *
 * These are the tests that matter most in the whole repository. The MCP route
 * runs on the Firebase Admin SDK, which bypasses every Firestore security rule,
 * so the API key check is not one layer of several — it is the only thing
 * between the open internet and a database of real people's home addresses.
 *
 * Which is why none of this is mocked. Keys are minted the way the browser
 * mints them, written to the emulated Firestore the way the app writes them,
 * and presented to a real HTTP server over the wire.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test, before, describe } from "node:test";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3399";
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8399";
const PROJECT = process.env.TEST_PROJECT ?? "demo-grimebusters-apitest";

/** Mints a key exactly as lib/db/apiKeys.ts does in the browser. */
function mint() {
  const key = `gbk_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  return { key, hash };
}

/** Writes a key document straight into the emulator's REST API. */
async function storeKey({ hash, label, scopes, revoked = false }) {
  const fields = {
    hash: { stringValue: hash },
    id: { stringValue: hash.slice(0, 12) },
    label: { stringValue: label },
    scopes: { arrayValue: { values: scopes.map((s) => ({ stringValue: s })) } },
    createdAt: { timestampValue: new Date().toISOString() },
    createdByName: { stringValue: "test" },
    lastUsedAt: { nullValue: null },
    revokedAt: revoked ? { timestampValue: new Date().toISOString() } : { nullValue: null },
  };
  // `Bearer owner` is the emulator's superuser token. Needed because the
  // apiKeys rules are admin-only and this seeding is not signed in as anybody —
  // the first run of this file was refused by those rules, which was the rules
  // working rather than a problem.
  const res = await fetch(
    `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/apiKeys?documentId=${hash}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
      body: JSON.stringify({ fields }),
    },
  );
  if (!res.ok) throw new Error(`could not seed key: ${res.status} ${await res.text()}`);
}

async function rpc(method, params, key) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

let readKey;
let sendKey;
let revokedKey;

before(async () => {
  const read = mint();
  await storeKey({ hash: read.hash, label: "Reporting", scopes: ["read"] });
  readKey = read.key;

  const send = mint();
  await storeKey({ hash: send.hash, label: "Ops Agent", scopes: ["read", "write", "send"] });
  sendKey = send.key;

  const dead = mint();
  await storeKey({ hash: dead.hash, label: "Old", scopes: ["read"], revoked: true });
  revokedKey = dead.key;
});

/* --------------------------------------------------------------- the door */

describe("getting in at all", () => {
  test("no key is refused", async () => {
    const { status } = await rpc("tools/list", {}, null);
    assert.equal(status, 401);
  });

  test("a made-up key is refused", async () => {
    const { status } = await rpc("tools/list", {}, mint().key);
    assert.equal(status, 401);
  });

  test("a key from another system is refused, and says so", async () => {
    const { status, json } = await rpc("tools/list", {}, "sk-ant-not-our-key-at-all-1234567890");
    assert.equal(status, 401);
    assert.match(json.error, /gbk_/, "should say what a real key looks like");
  });

  test("a revoked key is refused", async () => {
    // The whole point of revocation. If this passes, revoking does nothing.
    const { status, json } = await rpc("tools/list", {}, revokedKey);
    assert.equal(status, 401);
    assert.match(json.error, /revoked/i);
  });

  test("a valid key gets in", async () => {
    const { status, json } = await rpc("tools/list", {}, readKey);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.result.tools));
  });

  test("an unauthenticated caller learns nothing about the protocol", async () => {
    // No tool names, no schemas, no hint that this is even MCP.
    const { json } = await rpc("tools/list", {}, null);
    assert.equal(json.result, undefined);
    assert.ok(!JSON.stringify(json).includes("send_sms"));
  });

  test("GET does not hand out the catalogue", async () => {
    const res = await fetch(`${BASE}/api/mcp`);
    assert.equal(res.status, 405);
    assert.ok(!(await res.text()).includes("send_sms"));
  });
});

/* ------------------------------------------------------------- the scopes */

describe("what a key is allowed to do", () => {
  test("a read key is not even shown the texting tools", async () => {
    const { json } = await rpc("tools/list", {}, readKey);
    const names = json.result.tools.map((tool) => tool.name);
    assert.ok(names.includes("money_summary"));
    assert.ok(!names.includes("send_sms"), "a read key was offered send_sms");
    assert.ok(!names.includes("schedule_job"));
  });

  test("a read key calling send_sms is refused", async () => {
    // The assertion this whole file exists for. If it ever fails, a reporting
    // key can text a customer.
    const { json } = await rpc(
      "tools/call",
      { name: "send_sms", arguments: { customerId: "cust-oak", body: "hello" } },
      readKey,
    );
    assert.equal(json.result.isError, true);
    assert.match(json.result.content[0].text, /"send" scope/);
  });

  test("a read key cannot write either", async () => {
    const { json } = await rpc(
      "tools/call",
      { name: "create_lead", arguments: { firstName: "Mallory" } },
      readKey,
    );
    assert.equal(json.result.isError, true);
    assert.match(json.result.content[0].text, /"write" scope/);
  });

  test("a full key sees everything", async () => {
    const { json } = await rpc("tools/list", {}, sendKey);
    const names = json.result.tools.map((tool) => tool.name);
    for (const expected of ["find_customer", "create_lead", "send_sms", "schedule_job"]) {
      assert.ok(names.includes(expected), `missing ${expected}`);
    }
  });
});

/* ---------------------------------------------------------- the protocol */

describe("speaking MCP", () => {
  test("initialize answers with a protocol version and server name", async () => {
    const { json } = await rpc("initialize", {}, readKey);
    assert.match(json.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(json.result.serverInfo.name, "grime-busters-crm");
  });

  test("initialize tells the operator what this key can do", async () => {
    const { json } = await rpc("initialize", {}, readKey);
    assert.match(json.result.instructions, /read/);
    assert.ok(!json.result.instructions.includes("send"), "a read key should not claim send");
  });

  test("every advertised tool has a closed schema", async () => {
    const { json } = await rpc("tools/list", {}, sendKey);
    for (const tool of json.result.tools) {
      assert.equal(tool.inputSchema.type, "object", tool.name);
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
      assert.equal(typeof tool.description, "string");
    }
  });

  test("every advertised tool can actually be called", async () => {
    // Guards a tool listed in the catalogue with no implementation behind it:
    // it would list fine and 404 the first time an agent reached for it.
    const { json } = await rpc("tools/list", {}, sendKey);
    for (const tool of json.result.tools) {
      const called = await rpc("tools/call", { name: tool.name, arguments: {} }, sendKey);
      const text = JSON.stringify(called.json);
      assert.ok(!text.includes("No tool called"), `${tool.name} has no implementation`);
    }
  });

  test("an unknown tool is a readable refusal, not a crash", async () => {
    const { status, json } = await rpc(
      "tools/call",
      { name: "delete_everything", arguments: {} },
      sendKey,
    );
    assert.equal(status, 200);
    assert.equal(json.result.isError, true);
    assert.match(json.result.content[0].text, /No tool called/);
  });

  test("an unknown method is a JSON-RPC error", async () => {
    const { json } = await rpc("resources/list", {}, readKey);
    assert.equal(json.error.code, -32601);
  });

  test("malformed JSON does not take the server down", async () => {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${readKey}` },
      body: "{not json",
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).error.code, -32700);
  });
});

/* ------------------------------------------------------------ actually working */

describe("the read tools return real data", () => {
  test("find_customer finds a seeded customer", async () => {
    const { json } = await rpc(
      "tools/call",
      { name: "find_customer", arguments: { query: "oak" } },
      readKey,
    );
    assert.notEqual(json.result.isError, true, JSON.stringify(json.result));
    assert.ok(json.result.structuredContent.found >= 0);
  });

  test("money_summary returns the shape the agent expects", async () => {
    const { json } = await rpc(
      "tools/call",
      { name: "money_summary", arguments: { year: 2026 } },
      readKey,
    );
    const data = json.result.structuredContent;
    assert.equal(data.year, 2026);
    assert.equal(typeof data.received.total, "number");
    assert.equal(typeof data.received.fromJobs, "number");
    assert.equal(typeof data.received.fromInvoices, "number");
    assert.equal(typeof data.stillOwed, "number");
  });

  test("a bad argument is explained rather than thrown", async () => {
    const { json } = await rpc(
      "tools/call",
      { name: "add_note", arguments: { customerId: "nope", text: "hi" } },
      sendKey,
    );
    assert.equal(json.result.isError, true);
    assert.match(json.result.content[0].text, /find_customer/);
  });
});
