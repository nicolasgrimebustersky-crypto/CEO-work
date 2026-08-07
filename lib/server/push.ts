import "server-only";

import { getMessaging } from "firebase-admin/messaging";

import { adminDb, isAdminConfigured } from "./admin";

/**
 * Push notifications — the half that runs on the server.
 *
 * Sending is server-only for the obvious reason: a client that could send push
 * to another account could send anything to it. The browser writes the
 * notification record and asks this side to interrupt somebody; what actually
 * goes out is decided here, from tokens the recipients registered themselves.
 *
 * Messages are sent data-only, with no `notification` block. That hands display
 * to public/push-sw.js, which means one place decides what a notification looks
 * like — with a `notification` block the browser renders it itself, ignoring the
 * worker, and the two would drift apart the first time either changed.
 */

export interface PushMessage {
  forUids: string[];
  title: string;
  body: string;
  /** Where tapping it lands, as a path. */
  url: string;
  /** Collapse key — later messages with the same tag replace earlier ones. */
  tag: string;
}

export interface PushResult {
  /** Devices FCM accepted the message for. */
  sent: number;
  /** Registered devices that were tried. */
  devices: number;
  /** Dead tokens removed as a result of this send. */
  pruned: number;
}

const EMPTY: PushResult = { sent: 0, devices: 0, pruned: 0 };

/** Firestore rejects `in` queries above thirty values. */
const IN_LIMIT = 30;

interface StoredToken {
  id: string;
  token: string;
}

async function tokensFor(uids: string[]): Promise<StoredToken[]> {
  const found = new Map<string, StoredToken>();

  for (let i = 0; i < uids.length; i += IN_LIMIT) {
    const snap = await adminDb()
      .collection("pushTokens")
      .where("uid", "in", uids.slice(i, i + IN_LIMIT))
      .get();

    for (const doc of snap.docs) {
      const token = doc.get("token");
      // Keyed by token, not document id: a device that somehow filed itself
      // twice must still only be sent to once.
      if (typeof token === "string" && token) found.set(token, { id: doc.id, token });
    }
  }

  return [...found.values()];
}

/**
 * A token stops working when the app is uninstalled, the browser clears site
 * data, or the token is simply rotated — and none of those tell us. FCM's
 * rejection is the only reliable signal, so it is acted on: leaving dead rows in
 * place means every future send drags a growing tail of failures behind it.
 */
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export async function sendPush(message: PushMessage): Promise<PushResult> {
  if (!isAdminConfigured) return EMPTY;

  const uids = [...new Set(message.forUids.filter(Boolean))];
  if (uids.length === 0) return EMPTY;

  const stored = await tokensFor(uids);
  if (stored.length === 0) return EMPTY;

  const response = await getMessaging().sendEachForMulticast({
    tokens: stored.map((entry) => entry.token),
    // Every value has to be a string; there is no other type in a data message.
    data: {
      title: message.title,
      body: message.body,
      url: message.url,
      tag: message.tag,
    },
    webpush: {
      headers: {
        // A day. Longer than that and the job it is about has already happened.
        TTL: "86400",
        Urgency: "high",
      },
      fcmOptions: { link: message.url },
    },
  });

  const dead = response.responses
    .map((result, index) =>
      !result.success && DEAD_TOKEN_CODES.has(result.error?.code ?? "")
        ? stored[index].id
        : null,
    )
    .filter((id): id is string => id !== null);

  if (dead.length > 0) {
    const batch = adminDb().batch();
    for (const id of dead) batch.delete(adminDb().collection("pushTokens").doc(id));
    await batch.commit();
  }

  return { sent: response.successCount, devices: stored.length, pruned: dead.length };
}
