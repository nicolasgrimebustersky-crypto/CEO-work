"use client";

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { KEY_BYTES, KEY_PREFIX, cleanScopes, keyHint, type Scope } from "@/lib/apiKeys";
import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { getDb } from "@/lib/firebase";

/**
 * The admin's view of the API keys.
 *
 * Note what is absent: there is no way to read a key back. The plaintext is
 * shown once when it is minted and never stored, so a key that was not written
 * down is replaced rather than recovered. That is the same rule Twilio applies
 * to its own API keys, for the same reason.
 */

const COLLECTION = "apiKeys";

export interface ApiKeyRecord {
  /** The SHA-256 hash, which is also the document id. */
  id: string;
  /** A short identifier for the key, e.g. "gbk_a1b2c3". Not enough to use. */
  keyId: string;
  hint: string;
  label: string;
  scopes: Scope[];
  createdAt: Timestamp | null;
  createdByName: string;
  lastUsedAt: Timestamp | null;
  revokedAt: Timestamp | null;
}

function toRecord(snap: QueryDocumentSnapshot<DocumentData>): ApiKeyRecord {
  const data = snap.data();
  return {
    id: snap.id,
    keyId: typeof data.id === "string" ? data.id : snap.id.slice(0, 12),
    hint: typeof data.hint === "string" ? data.hint : "",
    label: typeof data.label === "string" ? data.label : "",
    scopes: cleanScopes(data.scopes),
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "",
    lastUsedAt: data.lastUsedAt instanceof Timestamp ? data.lastUsedAt : null,
    revokedAt: data.revokedAt instanceof Timestamp ? data.revokedAt : null,
  };
}

export function subscribeApiKeys(
  onChange: (keys: ApiKeyRecord[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<ApiKeyRecord>(COLLECTION, (rows) => onChange(rows));
  }
  return onSnapshot(
    query(collection(getDb(), COLLECTION), orderBy("createdAt", "desc")),
    (snap) => onChange(snap.docs.map(toRecord)),
    (error) => onError?.(error),
  );
}

/**
 * Writes the record for a key that was minted client-side.
 *
 * The hash is the document id, which is what lets the server resolve a
 * presented key in a single read rather than scanning a collection keyed by
 * secret.
 */
export async function saveApiKey(input: {
  hash: string;
  keyId: string;
  hint: string;
  label: string;
  scopes: Scope[];
  createdByName: string;
}): Promise<void> {
  const row = {
    hash: input.hash,
    id: input.keyId,
    hint: input.hint,
    label: input.label.trim(),
    scopes: input.scopes,
    createdAt: serverTimestamp(),
    createdByName: input.createdByName,
    lastUsedAt: null,
    revokedAt: null,
  };
  if (isDemoMode) {
    demo.add(COLLECTION, { ...row, id: input.hash, keyId: input.keyId });
    return;
  }
  await setDoc(doc(getDb(), COLLECTION, input.hash), row);
}

/**
 * Revokes rather than deletes.
 *
 * A revoked key stays visible so the record of what once had access survives —
 * deleting it would make a key that was used for six months disappear from the
 * history along with its last-used time.
 */
export async function revokeApiKey(id: string): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTION, id, { revokedAt: Timestamp.now() });
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, id), { revokedAt: serverTimestamp() });
}

/** For clearing out a key that was revoked long ago. */
export async function deleteApiKey(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTION, id);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTION, id));
}

/**
 * Mints a key in the browser.
 *
 * Deliberately here rather than on a server route: a key generated server-side
 * would travel back over the wire in a response, which is one more place it can
 * be logged. Generated here, the plaintext exists only in the tab that made it,
 * and only the hash is ever transmitted.
 *
 * The hash has to match what lib/server/apiKeyAuth.ts computes exactly — SHA-256
 * of the key's UTF-8 bytes, lowercase hex — or a freshly issued key is refused
 * the first time it is used. `tests/api.mcp.test.mjs` mints one this way and
 * presents it to the running server, which is what pins the two together.
 */
export async function mintApiKey(): Promise<{
  key: string;
  hash: string;
  keyId: string;
  hint: string;
}> {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);

  // base64url, matching Buffer.toString("base64url") on the server.
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const key = `${KEY_PREFIX}${base64}`;

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return { key, hash, keyId: hash.slice(0, 12), hint: keyHint(key) };
}
