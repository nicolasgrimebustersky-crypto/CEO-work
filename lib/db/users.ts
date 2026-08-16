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

import { isBootstrapCrew, SIGNUP_ROLE, type Role } from "@/lib/auth/roles";
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
    role: data.role === "crew" ? "crew" : "pending",
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
 * Creates the profile document the first time an account signs in.
 *
 * The role written here is the whole access decision. A new registration gets
 * `pending` and can see nothing until somebody inside approves it; the two
 * bootstrap uids get `crew`, because the first account cannot wait for an
 * approver who does not exist yet.
 *
 * The rules enforce exactly this and do not trust the value — a client writing
 * `crew` for itself is refused unless it is a bootstrap uid.
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
    role: isBootstrapCrew(uid) ? "crew" : SIGNUP_ROLE,
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

/**
 * Watches one profile — your own.
 *
 * Needed separately from the roster because a pending account cannot read the
 * users collection at all; the rules let it read exactly one document, its own.
 * This is how the app finds out whether you are approved yet.
 */
export function subscribeOwnProfile(
  uid: string,
  onChange: (user: AppUser | null) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<AppUser>(COLLECTIONS.users, (users) => {
      onChange(users.find((user) => user.uid === uid) ?? null);
    });
  }
  return onSnapshot(
    doc(getDb(), COLLECTIONS.users, uid),
    (snap) =>
      onChange(
        snap.exists()
          ? toAppUser(snap as QueryDocumentSnapshot<DocumentData>)
          : null,
      ),
    (error) => onError?.(error),
  );
}

/**
 * Let somebody in, or put them back out.
 *
 * Writes `role` on somebody else's profile, which the rules permit only for
 * crew and only for that one field. Deliberately not a self-service action:
 * granting access to real customers' addresses is a decision a person makes
 * about another person.
 */
export async function setUserRole(uid: string, role: Role): Promise<void> {
  await writeUser(uid, { role });
}
