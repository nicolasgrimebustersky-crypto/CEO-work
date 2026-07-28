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

import { COLLECTIONS, getDb } from "@/lib/firebase";
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
  };
}

export function subscribeUsers(
  onChange: (users: AppUser[]) => void,
  onError?: (error: Error) => void,
): () => void {
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
    createdAt: serverTimestamp(),
  });
}

export async function updateUserLocation(
  uid: string,
  lat: number,
  lng: number,
): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTIONS.users, uid), {
    currentLat: lat,
    currentLng: lng,
    lastLocationUpdate: serverTimestamp(),
    isActive: true,
  });
}

export async function setUserActive(uid: string, isActive: boolean): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTIONS.users, uid), { isActive });
}

/**
 * Removes this user's own profile document, for in-app account deletion.
 *
 * Must run before the Firebase Auth user is deleted: the rules identify the
 * caller by uid, and once the auth account is gone the write is refused. The
 * rules allow delete on a profile only for its owner.
 */
export async function deleteOwnProfile(uid: string): Promise<void> {
  await deleteDoc(doc(getDb(), COLLECTIONS.users, uid));
}

export async function updateUserProfile(
  uid: string,
  patch: { displayName?: string; phone?: string },
): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTIONS.users, uid), patch);
}
