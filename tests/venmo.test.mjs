/**
 * Venmo auto-matching: reading Venmo's "paid you" email, checking that Venmo
 * really signed it, verifying Resend's webhook, and choosing the bill.
 *
 * The signature tests sign real messages with a throwaway key and answer the
 * DNS lookup for it, so the exact check the webhook relies on is exercised —
 * including the forgeries it exists to stop.
 */
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { test, describe } from "node:test";

import { dkimSign } from "mailauth";

const { parseVenmoEmail, noteFromBody } = await import("../lib/venmoEmail.ts");
const { matchVenmoPayment, normalName } = await import("../lib/venmoMatch.ts");
const { verifySvixSignature } = await import("../lib/svixSignature.ts");
const { checkVenmoSignature, decodeHeader } = await import("../lib/venmoSignature.ts");

/* ------------------------------------------------------------ reading */

describe("reading a Venmo email", () => {
  test("a payment received: who, how much, and the note", () => {
    const p = parseVenmoEmail({
      subject: "Larry Lupinski paid you $45.00",
      text: "Larry Lupinski paid you\n$45.00\nmowing 10/31\nSee transaction\nVenmo is a service of PayPal",
    });
    assert.deepEqual(p, { payerName: "Larry Lupinski", amount: 45, note: "mowing 10/31" });
  });

  test("commas and missing cents", () => {
    assert.equal(parseVenmoEmail({ subject: "Giles paid you $1,600", text: "" }).amount, 1600);
  });

  test("a forwarded copy still reads", () => {
    assert.equal(parseVenmoEmail({ subject: "Fwd: Tiffany Blackwell paid you $42.00", text: "" }).payerName, "Tiffany Blackwell");
  });

  test("money going out, requests and other Venmo mail are not payments received", () => {
    for (const subject of [
      "You paid Larry Lupinski $45.00",
      "Larry Lupinski requests $45.00",
      "Your weekly Venmo summary",
      "Larry Lupinski paid you",
    ]) {
      assert.equal(parseVenmoEmail({ subject, text: "" }), null, subject);
    }
  });

  test("no note is an empty note, not boilerplate", () => {
    assert.equal(noteFromBody("Larry paid you\n$45.00\nSee transaction\nVenmo", "Larry"), "");
  });
});

/* ----------------------------------------------------------- matching */

const bill = (over) => ({ kind: "job", id: "j", customerId: "c", customerName: "Larry Lupinski", owed: 45, at: 0, ...over });

describe("choosing the bill", () => {
  test("an invoice number in the note wins", () => {
    const bills = [bill({ kind: "invoice", id: "d1", number: "8904", owed: 120 }), bill({ id: "j1" })];
    const r = matchVenmoPayment({ payerName: "Somebody Else", amount: 120, note: "inv #8904 thanks" }, bills);
    assert.equal(r.bill?.id, "d1");
  });

  test("an invoice number with more money than it owes is left for a person", () => {
    const r = matchVenmoPayment({ payerName: "X", amount: 500, note: "8904" }, [bill({ kind: "invoice", id: "d1", number: "8904", owed: 120 })]);
    assert.equal(r.bill, null);
    assert.equal(r.suggestions[0].id, "d1");
  });

  test("name plus exactly one bill for exactly this amount", () => {
    const bills = [bill({ id: "j1", owed: 45 }), bill({ id: "j2", owed: 90 }), bill({ id: "j3", customerId: "c2", customerName: "Brian Smith", owed: 45 })];
    assert.equal(matchVenmoPayment({ payerName: "larry  LUPINSKI", amount: 45, note: "" }, bills).bill?.id, "j1");
  });

  test("two bills for the same amount: nobody guesses", () => {
    const bills = [bill({ id: "j1" }), bill({ id: "j2" })];
    const r = matchVenmoPayment({ payerName: "Larry Lupinski", amount: 45, note: "" }, bills);
    assert.equal(r.bill, null);
    assert.equal(r.suggestions.length, 2);
  });

  test("two clients with the same name: nobody guesses", () => {
    const bills = [bill({ id: "j1", customerId: "a" }), bill({ id: "j2", customerId: "b", owed: 90 })];
    assert.equal(matchVenmoPayment({ payerName: "Larry Lupinski", amount: 45, note: "" }, bills).bill, null);
  });

  test("a name nobody has is suggested by amount instead", () => {
    const bills = [bill({ id: "j1", at: 1 }), bill({ id: "j2", customerName: "Ann S", owed: 45, at: 2 })];
    const r = matchVenmoPayment({ payerName: "Mrs Lupinski", amount: 45, note: "" }, bills);
    assert.equal(r.bill, null);
    assert.deepEqual(r.suggestions.map((s) => s.id), ["j2", "j1"]);
  });

  test("names compare without case, accents or punctuation", () => {
    assert.equal(normalName("  José  O'Neil "), normalName("jose o neil"));
  });
});

/* -------------------------------------------------- Resend's signature */

describe("Resend webhook signature", () => {
  const secret = "whsec_" + Buffer.from("test-secret-key-0123456789").toString("base64");
  const sign = (id, ts, body) =>
    "v1," + createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  const now = 1_800_000_000;

  test("a correct signature passes", () => {
    const body = '{"type":"email.received"}';
    assert.deepEqual(verifySvixSignature(body, { id: "m1", timestamp: String(now), signature: sign("m1", now, body) }, secret, now), { ok: true });
  });

  test("a changed body, an old timestamp or no signature fails", () => {
    const body = '{"type":"email.received"}';
    const sig = sign("m1", now, body);
    assert.equal(verifySvixSignature(body + " ", { id: "m1", timestamp: String(now), signature: sig }, secret, now).ok, false);
    assert.equal(verifySvixSignature(body, { id: "m1", timestamp: String(now), signature: sig }, secret, now + 3600).ok, false);
    assert.equal(verifySvixSignature(body, { id: "m1", timestamp: String(now), signature: null }, secret, now).ok, false);
  });
});

/* ----------------------------------------------------- Venmo's signature */

describe("Venmo's DKIM signature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const resolver = async (name, type) => {
    if (type === "TXT" && /^s1\._domainkey\./.test(name)) return [[`v=DKIM1; k=rsa; p=${pub}`]];
    const e = new Error("nx");
    e.code = "ENOTFOUND";
    throw e;
  };
  const message = (from, subject, body = "Larry Lupinski paid you\r\n$45.00\r\nmowing\r\n") =>
    `From: ${from}\r\nTo: venmo-x@pay.example.com\r\nSubject: ${subject}\r\nDate: Tue, 3 Nov 2026 10:00:00 -0500\r\nMessage-ID: <a@venmo.com>\r\n\r\n${body}`;
  const signAs = async (domain, raw) => {
    const s = await dkimSign(raw, {
      signatureData: [{ signingDomain: domain, selector: "s1", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) }],
    });
    return Buffer.from(s.signatures + raw);
  };

  test("signed by venmo.com: passes, and the signed subject is read", async () => {
    const raw = await signAs("venmo.com", message("Venmo <venmo@venmo.com>", "Larry Lupinski paid you $45.00"));
    const r = await checkVenmoSignature(raw, resolver);
    assert.equal(r.verified, true);
    assert.equal(r.signedSubject, "Larry Lupinski paid you $45.00");
  });

  test("the amount changed after signing: refused", async () => {
    const raw = await signAs("venmo.com", message("Venmo <venmo@venmo.com>", "Larry Lupinski paid you $45.00"));
    const forged = Buffer.from(raw.toString().replace("$45.00", "$450.00"));
    assert.equal((await checkVenmoSignature(forged, resolver)).verified, false);
  });

  test("a stranger's own valid signature, claiming to be Venmo: refused", async () => {
    const raw = await signAs("evil.example", message("Venmo <venmo@venmo.com>", "Larry Lupinski paid you $45.00"));
    assert.equal((await checkVenmoSignature(raw, resolver)).verified, false);
  });

  test("no signature at all: refused", async () => {
    const raw = Buffer.from(message("Venmo <venmo@venmo.com>", "Larry Lupinski paid you $45.00"));
    assert.equal((await checkVenmoSignature(raw, resolver)).verified, false);
  });

  test("a second Subject added above the signed one does not change what is read", async () => {
    const raw = await signAs("venmo.com", message("Venmo <venmo@venmo.com>", "Larry Lupinski paid you $45.00"));
    const injected = Buffer.from("Subject: Larry Lupinski paid you $900.00\r\n" + raw.toString());
    const r = await checkVenmoSignature(injected, resolver);
    if (r.verified) assert.equal(r.signedSubject, "Larry Lupinski paid you $45.00");
  });

  test("encoded subjects decode", () => {
    assert.equal(decodeHeader("=?UTF-8?Q?Jos=C3=A9_paid_you_$45.00?="), "José paid you $45.00");
  });
});
