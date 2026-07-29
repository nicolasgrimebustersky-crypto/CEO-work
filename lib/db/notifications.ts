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
import type { Author } from "@/lib/types";

export const NOTIFICATION_TYPES = [
  "job_created",
  "job_updated",
  "job_rescheduled",
  "job_completed",
  "job_cancelled",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

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
    type: NOTIFICATION_TYPES.includes(data.type as NotificationType)
      ? (data.type as NotificationType)
      : "job_updated",
    title: typeof data.title === "string" ? data.title : "",
    body: typeof data.body === "string" ? data.body : "",
    customerId: typeof data.customerId === "string" ? data.customerId : null,
    jobId: typeof data.jobId === "string" ? data.jobId : null,
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

/**
 * Notifies everyone on the crew except the person who performed the action —
 * being told about your own tap is noise, and this is a two-person app where
 * "the other user" is the entire audience.
 */
export async function notifyOthers(
  crewUids: string[],
  actor: Author,
  payload: {
    type: NotificationType;
    title: string;
    body: string;
    customerId?: string | null;
    jobId?: string | null;
  },
): Promise<void> {
  const recipients = crewUids.filter((uid) => uid !== actor.uid);
  const rowFor = (forUid: string) => ({
    forUid,
    actorUid: actor.uid,
    actorName: actor.displayName,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    customerId: payload.customerId ?? null,
    jobId: payload.jobId ?? null,
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
