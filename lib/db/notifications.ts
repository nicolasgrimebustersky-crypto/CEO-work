import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import {
  isNotificationType,
  recipientsFor,
  titleOf,
  type NotificationType,
} from "@/lib/notifications/events";
import { notificationLink } from "@/lib/notifications/link";
import { deliverPush } from "@/lib/push/client";
import type { Author } from "@/lib/types";

export { notificationLink };
export type { NotificationType };

export interface AppNotification {
  id: string;
  forUid: string;
  actorUid: string;
  actorName: string;
  type: NotificationType;
  title: string;
  body: string;
  customerId: string | null;
  jobId: string | null;
  documentId: string | null;
  createdAt: Timestamp;
  readAt: Timestamp | null;
}

function toNotification(snap: QueryDocumentSnapshot<DocumentData>): AppNotification {
  const data = snap.data();
  return {
    id: snap.id,
    forUid: typeof data.forUid === "string" ? data.forUid : "",
    actorUid: typeof data.actorUid === "string" ? data.actorUid : "",
    actorName: typeof data.actorName === "string" ? data.actorName : "Unknown",
    // An unknown type means this client is older than the one that wrote the
    // row. Falling back keeps the entry readable instead of dropping it.
    type: isNotificationType(data.type) ? data.type : "job_updated",
    title: typeof data.title === "string" ? data.title : "",
    body: typeof data.body === "string" ? data.body : "",
    customerId: typeof data.customerId === "string" ? data.customerId : null,
    jobId: typeof data.jobId === "string" ? data.jobId : null,
    documentId: typeof data.documentId === "string" ? data.documentId : null,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    readAt: data.readAt instanceof Timestamp ? data.readAt : null,
  };
}

/**
 * Needs the composite index declared in firestore.indexes.json
 * (forUid ASC, createdAt DESC). Without it Firestore rejects the query with a
 * console link to create one.
 */
export function subscribeNotifications(
  uid: string,
  onChange: (items: AppNotification[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<AppNotification>(COLLECTIONS.notifications, (items) =>
      onChange(
        items
          .filter((item) => item.forUid === uid)
          .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
          .slice(0, 50),
      ),
    );
  }

  const q = query(
    collection(getDb(), COLLECTIONS.notifications),
    where("forUid", "==", uid),
    orderBy("createdAt", "desc"),
    limit(50),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map(toNotification)),
    (error) => onError?.(error),
  );
}

/** The shape `notifyOthers` needs from the roster. `AppUser` satisfies it. */
export interface NotifyRecipient {
  uid: string;
  mutedNotifications?: string[] | null;
}

export interface NotifyPayload {
  type: NotificationType;
  /** The specifics — a name, an amount, a date. The title comes from the catalogue. */
  body: string;
  customerId?: string | null;
  jobId?: string | null;
  documentId?: string | null;
}

/**
 * Tells the rest of the crew that something happened.
 *
 * Two deliveries, and they are deliberately independent. The Firestore write is
 * the record — it drives the bell, survives the phone being off, and is the
 * thing you scroll back through. The push is the interruption, and it is
 * fire-and-forget: a failed push must never make a completed job look like it
 * failed to save, so the error is swallowed after the record is safely written.
 */
export async function notifyOthers(
  crew: readonly NotifyRecipient[],
  actor: Author,
  payload: NotifyPayload,
): Promise<void> {
  const recipients = recipientsFor(crew, actor.uid, payload.type);
  if (recipients.length === 0) return;

  const title = titleOf(payload.type);
  const rowFor = (forUid: string) => ({
    forUid,
    actorUid: actor.uid,
    actorName: actor.displayName,
    type: payload.type,
    title,
    body: payload.body,
    customerId: payload.customerId ?? null,
    jobId: payload.jobId ?? null,
    documentId: payload.documentId ?? null,
    createdAt: serverTimestamp(),
    readAt: null,
  });

  if (isDemoMode) {
    for (const forUid of recipients) demo.add(COLLECTIONS.notifications, rowFor(forUid));
    return;
  }

  await Promise.all(
    recipients.map((forUid) =>
      addDoc(collection(getDb(), COLLECTIONS.notifications), rowFor(forUid)),
    ),
  );

  void deliverPush({
    forUids: recipients,
    title,
    body: payload.body,
    url: notificationLink({
      type: payload.type,
      customerId: payload.customerId ?? null,
      documentId: payload.documentId ?? null,
    }),
    tag: payload.type,
  });
}

export async function markRead(notificationId: string): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTIONS.notifications, notificationId, { readAt: Timestamp.now() });
    return;
  }
  await updateDoc(doc(getDb(), COLLECTIONS.notifications, notificationId), {
    readAt: serverTimestamp(),
  });
}

export async function markAllRead(items: AppNotification[]): Promise<void> {
  const unread = items.filter((item) => item.readAt === null);
  if (unread.length === 0) return;

  const now = Timestamp.now();

  if (isDemoMode) {
    for (const item of unread) {
      demo.update(COLLECTIONS.notifications, item.id, { readAt: now });
    }
    return;
  }

  const batch = writeBatch(getDb());
  for (const item of unread) {
    batch.update(doc(getDb(), COLLECTIONS.notifications, item.id), { readAt: now });
  }
  await batch.commit();
}
