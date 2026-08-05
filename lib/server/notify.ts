import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import {
  isNotificationCategory,
  titleOf,
  wantsEvent,
  type NotificationType,
} from "@/lib/notifications/events";
import { notificationLink } from "@/lib/notifications/link";
import { adminDb, isAdminConfigured } from "./admin";
import { sendPush } from "./push";

/**
 * Notifications raised by the server rather than by somebody tapping.
 *
 * Three things happen to this business without anyone touching the app: a
 * customer texts back, a Facebook lead form comes in, and the follow-up cron
 * chases a quote. Those are the events most worth being told about, precisely
 * because nobody was looking at the time — but they were the only ones with no
 * way to say so, since the notification writer lived in the browser.
 *
 * The recipient list comes from CREW_UIDS. It has to: there is no signed-in user
 * on a Twilio webhook, so "the crew" cannot be inferred from the caller. That is
 * the same allowlist the API routes authorise against, so it is already required
 * to be correct.
 */

interface ServerNotifyPayload {
  type: NotificationType;
  body: string;
  customerId?: string | null;
  documentId?: string | null;
  /** Who or what caused it — "Customer", "Facebook", "Grime Busters". */
  actorName: string;
}

function crewUids(): string[] {
  return (process.env.CREW_UIDS ?? "")
    .split(",")
    .map((uid) => uid.trim())
    .filter(Boolean);
}

/** Honours each person's muted categories, the same as the client path does. */
async function willingRecipients(type: NotificationType): Promise<string[]> {
  const uids = crewUids();
  if (uids.length === 0) return [];

  const docs = await adminDb().getAll(
    ...uids.map((uid) => adminDb().collection("users").doc(uid)),
  );

  return docs
    .filter((doc) => {
      const stored = doc.get("mutedNotifications");
      const muted = Array.isArray(stored) ? stored.filter(isNotificationCategory) : [];
      return wantsEvent(muted, type);
    })
    .map((doc) => doc.id);
}

/**
 * Writes the record and sends the push.
 *
 * Never throws. Every caller is a webhook or a cron job whose actual work —
 * logging the reply, importing the lead, sending the follow-up text — has
 * already succeeded by the time this runs, and failing that work because a
 * notification could not be written would be exactly backwards. Twilio in
 * particular retries any non-2xx, which would duplicate the note.
 */
export async function notifyCrew(payload: ServerNotifyPayload): Promise<void> {
  if (!isAdminConfigured) return;

  try {
    const recipients = await willingRecipients(payload.type);
    if (recipients.length === 0) return;

    const title = titleOf(payload.type);
    const batch = adminDb().batch();
    for (const forUid of recipients) {
      batch.set(adminDb().collection("notifications").doc(), {
        forUid,
        // No crew member did this, and pretending one did would put somebody's
        // name and colour on an event they had nothing to do with.
        actorUid: "system",
        actorName: payload.actorName,
        type: payload.type,
        title,
        body: payload.body.slice(0, 300),
        customerId: payload.customerId ?? null,
        jobId: null,
        documentId: payload.documentId ?? null,
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });
    }
    await batch.commit();

    await sendPush({
      forUids: recipients,
      title,
      body: payload.body.slice(0, 300),
      url: notificationLink(payload),
      tag: payload.type,
    });
  } catch (error) {
    console.error(`Could not raise a ${payload.type} notification`, error);
  }
}
