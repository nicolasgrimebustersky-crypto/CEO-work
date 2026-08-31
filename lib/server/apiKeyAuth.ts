import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  KEY_BYTES,
  KEY_PREFIX,
  bearerFrom,
  cleanScopes,
  keyHint,
  looksLikeKey,
  normalizeKey,
  scopeProblem,
  type Scope,
  type StoredKey,
} from "@/lib/apiKeys";
import { adminDb } from "./admin";
import { ApiError } from "./auth";

/**
 * Checking an API key.
 *
 * Read this with one fact in mind: the MCP route runs on the Admin SDK, which
 * bypasses every Firestore security rule. Nothing behind this file re-checks
 * anything. This function is the entire boundary between the open internet and
 * a database of real people's home addresses.
 *
 * Keys are stored as SHA-256 hashes. A key is high-entropy random — 256 bits —
 * so there is no dictionary to attack and no salt needed; the hash exists so
 * that a copy of the database is not a set of working credentials.
 */

const COLLECTION = "apiKeys";

export function hashKey(key: string): string {
  return createHash("sha256").update(normalizeKey(key)).digest("hex");
}

/** A fresh key. The plaintext is returned once and never stored. */
export function mintKey(): { key: string; hash: string; hint: string } {
  const key = `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString("base64url")}`;
  return { key, hash: hashKey(key), hint: keyHint(key) };
}

/**
 * Compares two hashes without leaking how far they matched.
 *
 * The lookup below is by document id, so timing is not the practical attack
 * here — but comparing secrets with `===` is the kind of thing that is correct
 * until the code around it is refactored, and the constant-time version costs
 * nothing.
 */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface AuthorisedKey extends StoredKey {
  scopes: Scope[];
}

/**
 * Resolves the Authorization header to a live key, or throws.
 *
 * Every failure is a 401 with the same shape and no detail about *which* key
 * was tried, because an error that distinguishes "no such key" from "revoked
 * key" tells somebody probing which of their guesses was once real.
 *
 * The one exception is a malformed header, which says so plainly: that is
 * somebody who has the key and pasted it wrong, not somebody guessing.
 */
export async function requireApiKey(request: Request): Promise<AuthorisedKey> {
  const presented = bearerFrom(request.headers.get("authorization"));
  if (!presented) {
    throw new ApiError(401, "Send your API key as an Authorization: Bearer header.");
  }
  if (!looksLikeKey(presented)) {
    throw new ApiError(
      401,
      `That does not look like a Grime Busters API key — they start with "${KEY_PREFIX}". Generate one on the Account screen.`,
    );
  }

  // The hash *is* the document id, so this is one read rather than a scan. A
  // scan over a collection keyed by secret would be both slower and a way to
  // enumerate how many keys exist.
  const hash = hashKey(presented);
  const snap = await adminDb().collection(COLLECTION).doc(hash).get();
  if (!snap.exists) throw new ApiError(401, "That API key is not valid.");

  const data = snap.data() ?? {};
  if (!sameHash(typeof data.hash === "string" ? data.hash : "", hash)) {
    throw new ApiError(401, "That API key is not valid.");
  }
  if (data.revokedAt != null) throw new ApiError(401, "That API key has been revoked.");

  // Fire and forget: a failed bookkeeping write must never refuse a valid key.
  // It is how an unexpectedly active key becomes visible on the Account screen,
  // not something the request depends on.
  void snap.ref
    .update({ lastUsedAt: new Date() })
    .catch(() => {});

  return {
    id: typeof data.id === "string" && data.id ? data.id : snap.id.slice(0, 12),
    label: typeof data.label === "string" ? data.label : "",
    scopes: cleanScopes(data.scopes),
  };
}

/** Refuses a tool this key was not issued for. See lib/apiKeys.ts. */
export function requireScope(key: AuthorisedKey, needed: Scope): void {
  const problem = scopeProblem(key, needed);
  if (problem) throw new ApiError(403, problem);
}
