import "server-only";

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { OTP_CLAIM, OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_TTL_MS, withVerifiedSession } from "@/lib/otp";
import { adminAuth, adminDb } from "./admin";

/**
 * Issuing, checking and recording sign-in codes. Server only, Admin SDK only.
 *
 * The code itself is never stored — a salted hash is, in `otpCodes/{uid}`, a
 * collection no client can read (see firestore.rules). One document per
 * account: asking for a new code replaces the old one, so there is never a
 * pile of live codes to guess at.
 */

const COLLECTION = "otpCodes";

function hashCode(salt: string, code: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

/** A fresh code for this account, replacing any earlier one. Returns it once. */
export async function issueCode(uid: string): Promise<string> {
  // randomInt is the CSPRNG path; Math.random would be guessable in principle
  // and this is the one number in the app that must not be.
  const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
  const salt = randomBytes(16).toString("hex");

  await adminDb()
    .collection(COLLECTION)
    .doc(uid)
    .set({
      hash: hashCode(salt, code),
      salt,
      attempts: 0,
      expiresAt: Timestamp.fromMillis(Date.now() + OTP_TTL_MS),
      createdAt: FieldValue.serverTimestamp(),
    });

  return code;
}

export type CodeCheck = "ok" | "wrong" | "expired" | "locked";

/**
 * Checks a code against what was issued, and burns it on success.
 *
 * Runs in a transaction so two guesses landing together both count: a
 * read-then-write outside one would let parallel requests share an attempt.
 * The comparison is constant-time, which matters less than it sounds for a
 * hash but costs nothing.
 */
export async function checkCode(uid: string, code: string): Promise<CodeCheck> {
  const ref = adminDb().collection(COLLECTION).doc(uid);

  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "expired";

    const data = snap.data() ?? {};
    const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
    const attempts = typeof data.attempts === "number" ? data.attempts : 0;
    const salt = typeof data.salt === "string" ? data.salt : "";
    const stored = typeof data.hash === "string" ? data.hash : "";

    if (Date.now() > expiresAt) {
      tx.delete(ref);
      return "expired";
    }
    if (attempts >= OTP_MAX_ATTEMPTS) {
      tx.delete(ref);
      return "locked";
    }

    const candidate = Buffer.from(hashCode(salt, code), "hex");
    const expected = Buffer.from(stored, "hex");
    const matches =
      candidate.length === expected.length && timingSafeEqual(candidate, expected);

    if (!matches) {
      tx.update(ref, { attempts: attempts + 1 });
      return "wrong";
    }

    // Works once. Verified, the code is gone.
    tx.delete(ref);
    return "ok";
  });
}

/**
 * Records that the sign-in with this `auth_time` has passed. The claim lands
 * in the account's next ID token; the client asks for a fresh one straight
 * after so the app opens without waiting for the hourly refresh.
 *
 * Other custom claims are carried through untouched. There are none today,
 * but the day there are, this must not be the thing that erased them.
 */
export async function markSessionVerified(uid: string, authTime: number): Promise<void> {
  const user = await adminAuth().getUser(uid);
  const existing = user.customClaims ?? {};
  await adminAuth().setCustomUserClaims(uid, {
    ...existing,
    [OTP_CLAIM]: withVerifiedSession(existing[OTP_CLAIM], authTime),
  });
}
