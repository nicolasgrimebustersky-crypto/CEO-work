import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { within } from "@/lib/knock/territory";
import type { Author, Customer, LatLng, Territory } from "@/lib/types";

const COLLECTION = COLLECTIONS.territories;

/**
 * A drawn boundary comes back from Firestore as an array of maps, and there is
 * nothing stopping a bad write putting strings in there. A vertex that is not
 * two numbers would render the polygon somewhere in the Atlantic, so bad points
 * are dropped rather than trusted.
 */
function asBoundary(value: unknown): LatLng[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (point): point is LatLng =>
        typeof point === "object" &&
        point !== null &&
        typeof (point as LatLng).lat === "number" &&
        typeof (point as LatLng).lng === "number",
    )
    .map((point) => ({ lat: point.lat, lng: point.lng }));
}

export function toTerritory(snap: QueryDocumentSnapshot<DocumentData>): Territory {
  const data = snap.data();
  return {
    id: snap.id,
    name: typeof data.name === "string" ? data.name : "Untitled territory",
    boundary: asBoundary(data.boundary),
    assignedTo: Array.isArray(data.assignedTo)
      ? data.assignedTo.filter((uid): uid is string => typeof uid === "string")
      : [],
    notes: typeof data.notes === "string" ? data.notes : "",
    active: data.active !== false,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    updatedByName: typeof data.updatedByName === "string" ? data.updatedByName : null,
  };
}

export function subscribeTerritories(
  onChange: (territories: Territory[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const sorted = (items: Territory[]) =>
    [...items].sort((a, b) => {
      // Retired ground sinks; otherwise alphabetical, because a territory is a
      // place and you look for it by name.
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  if (isDemoMode) {
    return demo.subscribe<Territory>(COLLECTION, (items) => onChange(sorted(items)));
  }
  return onSnapshot(
    query(collection(getDb(), COLLECTION), orderBy("createdAt", "desc")),
    (snap) => onChange(sorted(snap.docs.map(toTerritory))),
    (error) => onError?.(error),
  );
}

export async function createTerritory(
  input: { name: string; boundary: LatLng[]; assignedTo: string[]; notes?: string },
  author: Author,
): Promise<string> {
  const payload = {
    name: input.name.trim() || "Untitled territory",
    boundary: input.boundary,
    assignedTo: input.assignedTo,
    notes: input.notes ?? "",
    active: true,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  if (isDemoMode) return demo.add(COLLECTION, payload);
  const ref = await addDoc(collection(getDb(), COLLECTION), payload);
  return ref.id;
}

export async function updateTerritory(
  territory: Territory,
  patch: {
    name?: string;
    boundary?: LatLng[];
    assignedTo?: string[];
    notes?: string;
    active?: boolean;
  },
  author: Author,
): Promise<void> {
  const next: Record<string, unknown> = {
    ...patch,
    ...(patch.name !== undefined
      ? { name: patch.name.trim() || "Untitled territory" }
      : {}),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  if (isDemoMode) {
    demo.update(COLLECTION, territory.id, next);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, territory.id), next);
}

export async function deleteTerritory(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTION, id);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTION, id));
}

/* --------------------------------------------------------------- reading */

/** Every pin standing inside this territory's outline. */
export function pinsIn(territory: Territory, customers: Customer[]): Customer[] {
  return within(customers, territory.boundary);
}

/**
 * Which territory a point falls in.
 *
 * Territories are not stopped from overlapping — drawing two shapes that share
 * a street corner is easy to do by accident and not worth blocking — so the
 * first match wins and the list order decides. Retired ground is skipped
 * entirely: it is kept for the record, not for assigning work.
 */
export function territoryAt(
  point: LatLng,
  territories: Territory[],
): Territory | null {
  return (
    territories
      .filter((territory) => territory.active)
      .find((territory) => within([point], territory.boundary).length === 1) ?? null
  );
}

/** Territories this person owns, plus unclaimed ground. */
export function territoriesFor(territories: Territory[], uid: string | null): Territory[] {
  if (!uid) return territories;
  return territories.filter(
    (territory) => territory.assignedTo.length === 0 || territory.assignedTo.includes(uid),
  );
}
