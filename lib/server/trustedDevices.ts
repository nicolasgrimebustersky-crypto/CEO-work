import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  checkTrust,
  composeToken,
  deviceLabel,
  expiryFrom,
  parseToken,
  type TrustVerdict,
} from "@/lib/trustedDevice";
import { adminDb } from "./admin";

/**
 * Issuing and redeeming the "trust this device" secret.
 *
 * Server only, Admin SDK only, and the collection has no block in
 * firestore.rules — which is what makes it server only. Rules deny by default,
 * so a collection nothing matches cannot be read or written by any client,
 * while the Admin SDK bypasses rules entirely. `otpCodes` and `apiKeys` are
 * kept the same way, and for the same reason: these documents are the thing
 * the sign-in code protects, so the sign-in code's own records must sit
 * somewhere a signed-in client cannot reach even when it is behaving.
 *
 * The secret is never stored. A salted SHA-256 is, exactly as `issueCode`
 * stores the six digits next door, so somebody who walks off with the database
 * holds hashes and gains nothing.
 */

const COLLECTION = "trustedDevices";

function hashSecret(salt: string, secret: string): string {
  return createHash("sha256").update(`${salt}:${secret}`).digest("hex");
}

/**
 * Constant-time compare of two hex digests.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak the
 * one bit it exists to hide, so the lengths are checked first and a mismatch
 * answers false rather than throwing. Both sides are hex of a fixed-width
 * digest, so unequal lengths mean corruption rather than a near guess.
 */
function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * A new trusted device for this account. Returns the token once, in full.
 *
 * The only moment the secret exists outside the caller's browser. It is not
 * logged, not returned again, and not recoverable — losing it costs one typed
 * code, which is the right price for never being able to leak it twice.
 */
export async function issueTrustedDevice(
  uid: string,
  userAgent: unknown,
  nowMs: number = Date.now(),
): Promise<string> {
  const id = randomBytes(16).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const salt = randomBytes(16).toString("hex");

  await adminDb()
    .collection(COLLECTION)
    .doc(id)
    .set({
      uid,
      hash: hashSecret(salt, secret),
      salt,
      label: deviceLabel(userAgent),
      expiresAt: Timestamp.fromMillis(expiryFrom(nowMs)),
      revokedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      lastUsedAt: null,
    });

  return composeToken({ id, secret });
}

export interface RedeemResult {
  ok: boolean;
  /** Why not, for the audit log. Never shown to the client — see the route. */
  reason: string;
}

/**
 * Checks a token and, if it is good, records the use.
 *
 * Every refusal returns the same shape and the route turns all of them into
 * the same answer. A caller holding a token learns whether it worked and
 * nothing else: not whether the id exists, not whether it belongs to somebody
 * else, not whether it expired yesterday. Those distinctions are useful only
 * to somebody who should not have it.
 *
 * The hash comparison happens even when the record is already doomed, so a
 * wrong id and a wrong secret take the same time to refuse.
 */
export async function redeemTrustedDevice(
  uid: string,
  rawToken: unknown,
  nowMs: number = Date.now(),
): Promise<RedeemResult> {
  const token = parseToken(rawToken);
  if (!token) return { ok: false, reason: "malformed" };

  const ref = adminDb().collection(COLLECTION).doc(token.id);
  const snap = await ref.get();

  const data = snap.exists ? (snap.data() ?? {}) : null;
  const record = data
    ? {
        uid: typeof data.uid === "string" ? data.uid : "",
        expiresAtMs: data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0,
        revoked: data.revokedAt !== null && data.revokedAt !== undefined,
      }
    : null;

  const verdict: TrustVerdict = checkTrust(record, uid, nowMs);

  // Done unconditionally, against a dummy of the same shape when there is no
  // record, so "no such device" and "wrong secret" cost the same.
  const salt = typeof data?.salt === "string" ? data.salt : "0".repeat(32);
  const stored = typeof data?.hash === "string" ? data.hash : "0".repeat(64);
  const secretMatches = sameDigest(stored, hashSecret(salt, token.secret));

  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  if (!secretMatches) return { ok: false, reason: "bad-secret" };

  await ref.update({ lastUsedAt: Timestamp.fromMillis(nowMs) });
  return { ok: true, reason: "" };
}

export interface TrustedDeviceRow {
  id: string;
  label: string;
  expiresAtMs: number;
  lastUsedAtMs: number | null;
}

/** The account's live trusted devices, newest expiry first. For the Account screen. */
export async function listTrustedDevices(
  uid: string,
  nowMs: number = Date.now(),
): Promise<TrustedDeviceRow[]> {
  const snap = await adminDb().collection(COLLECTION).where("uid", "==", uid).get();
  const rows: TrustedDeviceRow[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const expiresAtMs = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
    // Expired and revoked ones are not shown. A list of dead devices invites
    // somebody to "revoke" something that already cannot do anything, and
    // teaches them the button does less than it does.
    if (expiresAtMs <= nowMs) continue;
    if (data.revokedAt !== null && data.revokedAt !== undefined) continue;
    rows.push({
      id: doc.id,
      label: typeof data.label === "string" ? data.label : "Unknown device",
      expiresAtMs,
      lastUsedAtMs: data.lastUsedAt instanceof Timestamp ? data.lastUsedAt.toMillis() : null,
    });
  }
  return rows.sort((a, b) => b.expiresAtMs - a.expiresAtMs);
}

/**
 * Untrusts every device on this account. Returns how many were live.
 *
 * Marked revoked rather than deleted, so the audit trail keeps the fact that a
 * device existed and when it stopped being trusted. A deleted row and a row
 * that was never there read identically afterwards, and "was anything else
 * signed in?" is exactly the question somebody asks after losing a phone.
 */
export async function revokeAllTrustedDevices(
  uid: string,
  nowMs: number = Date.now(),
): Promise<number> {
  const snap = await adminDb().collection(COLLECTION).where("uid", "==", uid).get();
  const batch = adminDb().batch();
  let live = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.revokedAt !== null && data.revokedAt !== undefined) continue;
    live += 1;
    batch.update(doc.ref, { revokedAt: Timestamp.fromMillis(nowMs) });
  }

  if (live > 0) await batch.commit();
  return live;
}
