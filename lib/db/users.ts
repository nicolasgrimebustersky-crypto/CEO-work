import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  collection,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import {
  isNotificationCategory,
  type NotificationCategory,
} from "@/lib/notifications/events";
import type { AppUser } from "@/lib/types";

function toAppUser(snap: QueryDocumentSnapshot<DocumentData>): AppUser {
  const data = snap.data();
  return {
    uid: snap.id,
    displayName: typeof data.displayName === "string" ? data.displayName : "Unknown",
    phone: typeof data.phone === "string" ? data.phone : "",
    currentLat: typeof data.currentLat === "number" ? data.currentLat : null,
    currentLng: typeof data.currentLng === "number" ? data.currentLng : null,
    lastLocationUpdate:
      data.lastLocationUpdate instanceof Timestamp ? data.lastLocationUpdate : null,
    isActive: data.isActive === true,
    color: typeof data.color === "string" ? data.color : null,
    mutedNotifications: Array.isArray(data.mutedNotifications)
      ? data.mutedNotifications.filter(isNotificationCategory)
      : [],
    // Absent means this profile predates the setting. On by default: somebody
    // who has never been asked would rather not be woken at 3am.
    quietHours: data.quietHours !== false,
  };
}

export function subscribeUsers(
  onChange: (users: AppUser[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) return demo.subscribe<AppUser>(COLLECTIONS.users, onChange);
  return onSnapshot(
    collection(getDb(), COLLECTIONS.users),
    (snap) => onChange(snap.docs.map(toAppUser)),
    (error) => onError?.(error),
  );
}

/**
 * Accounts are created by hand in the Firebase console, so the first time one
 * of them signs in there is an auth user but no profile document. Create it
 * here rather than making the console step a two-part job.
 */
export async function ensureUserDoc(
  uid: string,
  fallbackName: string,
): Promise<void> {
  // The demo crew already exists in the seed data.
  if (isDemoMode) return;

  const ref = doc(getDb(), COLLECTIONS.users, uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return;

  await setDoc(ref, {
    displayName: fallbackName,
    phone: "",
    currentLat: null,
    currentLng: null,
    lastLocationUpdate: null,
    isActive: true,
    // Nothing muted: a new account hears about everything until it says
    // otherwise, which is the only default that cannot lose an event silently.
    mutedNotifications: [],
    quietHours: true,
    createdAt: serverTimestamp(),
  });
}

/** Single persistence point, so demo mode swaps the write and nothing else. */
async function writeUser(uid: string, patch: Record<string, unknown>): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTIONS.users, uid, patch);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTIONS.users, uid), patch);
}

export async function updateUserLocation(
  uid: string,
  lat: number,
  lng: number,
): Promise<void> {
  await writeUser(uid, {
    currentLat: lat,
    currentLng: lng,
    lastLocationUpdate: serverTimestamp(),
    isActive: true,
  });
}

export async function setUserActive(uid: string, isActive: boolean): Promise<void> {
  await writeUser(uid, { isActive });
}

/**
 * Removes this user's own profile document, for in-app account deletion.
 *
 * Must run before the Firebase Auth user is deleted: the rules identify the
 * caller by uid, and once the auth account is gone the write is refused. The
 * rules allow delete on a profile only for its owner.
 */
export async function deleteOwnProfile(uid: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTIONS.users, uid);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTIONS.users, uid));
}

export async function updateUserProfile(
  uid: string,
  patch: { displayName?: string; phone?: string },
): Promise<void> {
  await writeUser(uid, patch);
}

/**
 * Hold push overnight, or do not.
 *
 * Per person rather than per device: it is a statement about when you want to
 * be disturbed, not about which handset you happened to grant permission on.
 */
export async function setQuietHours(uid: string, on: boolean): Promise<void> {
  await writeUser(uid, { quietHours: on });
}

/**
 * Which notification categories this person does not want.
 *
 * Written to their own profile because it is read at *sending* time by whoever
 * raised the event — the rules let both crew read each other's profile but only
 * write their own, so one person can honour the other's preference without
 * being able to change it.
 */
export async function setMutedNotifications(
  uid: string,
  muted: NotificationCategory[],
): Promise<void> {
  await writeUser(uid, { mutedNotifications: muted });
}
