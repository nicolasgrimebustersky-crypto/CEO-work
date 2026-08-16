import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";

/**
 * One document per device that has agreed to receive push.
 *
 * The document id is a SHA-256 of the registration token rather than the token
 * itself. Two reasons: FCM tokens are not guaranteed to be free of characters
 * Firestore reserves in a document path, and a hash gives the same device the
 * same id every time — so re-registering updates a row instead of leaving a
 * trail of stale ones behind it. The token is stored in the document, because
 * the server needs the real value to send anything.
 *
 * Tokens expire and get reissued by the browser without asking anyone, so this
 * collection is expected to accumulate dead rows. `/api/push/send` deletes the
 * ones FCM rejects, which is the only reliable signal that one is dead.
 */

/** Path-safe, stable, and the same length for every token. */
async function tokenId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A human-readable note of which device this is, so the Account screen can say
 * "this phone" rather than showing a 160-character token. Coarse on purpose —
 * enough to recognise your own handset, not a fingerprint.
 */
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "Unknown device";
  const ua = navigator.userAgent;
  const platform = /iPhone|iPad|iPod/.test(ua)
    ? "iPhone"
    : /Android/.test(ua)
      ? "Android"
      : /Mac/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : "Device";
  const browser = /CriOS|Chrome/.test(ua)
    ? "Chrome"
    : /FxiOS|Firefox/.test(ua)
      ? "Firefox"
      : /Safari/.test(ua)
        ? "Safari"
        : "Browser";
  return `${platform} · ${browser}`;
}

export async function savePushToken(uid: string, token: string): Promise<void> {
  if (isDemoMode) return;

  const id = await tokenId(token);
  await setDoc(
    doc(getDb(), COLLECTIONS.pushTokens, id),
    {
      uid,
      token,
      label: deviceLabel(),
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    },
    // merge so a device that re-registers keeps its original createdAt.
    { merge: true },
  );
}

/** Cheap heartbeat on an already-registered device, run at sign-in. */
export async function touchPushToken(token: string): Promise<void> {
  if (isDemoMode) return;
  try {
    await updateDoc(doc(getDb(), COLLECTIONS.pushTokens, await tokenId(token)), {
      lastSeenAt: serverTimestamp(),
    });
  } catch {
    // The document may not exist yet on a first run; savePushToken creates it.
  }
}

export async function deletePushToken(token: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTIONS.pushTokens, token);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTIONS.pushTokens, await tokenId(token)));
}
