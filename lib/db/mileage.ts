"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type DocumentData,
} from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { TRIP_SOURCES, type Place, type TripSource } from "@/lib/mileage";
import { asOrgId, DEFAULT_ORG_ID } from "@/lib/org";
import type { Author } from "@/lib/types";

const COLLECTION = COLLECTIONS.mileage;

export interface Trip {
  id: string;
  orgId: string;
  date: string;
  miles: number;
  reason: string;
  source: TripSource;
  /** True when Google could not give road miles and the straight-line estimate was used. */
  estimated: boolean;
  from: (Place & { label: string }) | null;
  to: (Place & { label: string }) | null;
  jobIds: string[];
  /** For a trip logged from a job tap: "auto:<jobId>", so a second tap rewrites it rather than adding one. */
  suggestionKey: string | null;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
}

function asPlace(v: unknown): (Place & { label: string }) | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (typeof p.lat !== "number" || typeof p.lng !== "number") return null;
  return { lat: p.lat, lng: p.lng, label: typeof p.label === "string" ? p.label : "" };
}

export function toTrip(id: string, data: DocumentData): Trip {
  return {
    id,
    orgId: asOrgId(data.orgId),
    date: typeof data.date === "string" ? data.date : "1970-01-01",
    miles: typeof data.miles === "number" && Number.isFinite(data.miles) ? data.miles : 0,
    reason: typeof data.reason === "string" ? data.reason : "",
    source: TRIP_SOURCES.includes(data.source) ? (data.source as TripSource) : "manual",
    estimated: data.estimated === true,
    from: asPlace(data.from),
    to: asPlace(data.to),
    jobIds: Array.isArray(data.jobIds) ? data.jobIds.filter((x: unknown): x is string => typeof x === "string") : [],
    suggestionKey: typeof data.suggestionKey === "string" ? data.suggestionKey : null,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
  };
}

const newest = (items: Trip[]) =>
  [...items].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.toMillis() - a.createdAt.toMillis());

/** The owner sees every trip; anyone else their own. Same split as firestore.rules. */
export function subscribeTrips(
  viewer: { uid: string; isOwner: boolean },
  onChange: (trips: Trip[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<Record<string, unknown>>(COLLECTION, (rows) =>
      onChange(
        newest(rows.map((r) => toTrip(String(r.id), r)).filter((t) => viewer.isOwner || t.createdBy === viewer.uid)),
      ),
    );
  }
  const base = collection(getDb(), COLLECTION);
  const q = viewer.isOwner ? query(base) : query(base, where("createdBy", "==", viewer.uid));
  return onSnapshot(
    q,
    (snap) => onChange(newest(snap.docs.map((d) => toTrip(d.id, d.data())))),
    (error) => onError?.(error),
  );
}

export interface NewTrip {
  date: string;
  miles: number;
  reason: string;
  source: TripSource;
  estimated: boolean;
  from?: (Place & { label: string }) | null;
  to?: (Place & { label: string }) | null;
  jobIds?: string[];
  suggestionKey?: string | null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export async function logTrip(trip: NewTrip, author: Author): Promise<void> {
  const payload = {
    orgId: DEFAULT_ORG_ID,
    date: trip.date,
    miles: round1(trip.miles),
    reason: trip.reason.trim().slice(0, 200),
    source: trip.source,
    estimated: trip.estimated,
    from: trip.from ?? null,
    to: trip.to ?? null,
    jobIds: (trip.jobIds ?? []).slice(0, 2),
    suggestionKey: trip.suggestionKey ?? null,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  // A keyed trip's id is derived from its key, so logging it twice — a second
  // "On my way" tap, two phones — writes one trip, not two.
  const id = trip.suggestionKey ? `${author.uid}_${trip.suggestionKey.replace(/[^A-Za-z0-9_-]/g, "_")}` : null;
  if (isDemoMode) {
    if (id) demo.put(COLLECTION, id, payload);
    else demo.add(COLLECTION, payload);
    return;
  }
  const ref = id ? doc(getDb(), COLLECTION, id) : doc(collection(getDb(), COLLECTION));
  await setDoc(ref, payload);
}

export async function deleteTrip(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTION, id);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTION, id));
}

/* ------------------------------------------------------------------ home */

export interface MileageHome extends Place {
  label: string;
}

export async function getMileageHome(uid: string): Promise<MileageHome | null> {
  if (isDemoMode) {
    const row = demo.get<Record<string, unknown>>(COLLECTIONS.mileageHomes, uid);
    return row ? (asPlace(row) as MileageHome | null) : null;
  }
  try {
    const snap = await getDoc(doc(getDb(), COLLECTIONS.mileageHomes, uid));
    return snap.exists() ? (asPlace(snap.data()) as MileageHome | null) : null;
  } catch {
    return null;
  }
}

export async function setMileageHome(uid: string, home: MileageHome): Promise<void> {
  const payload = { orgId: DEFAULT_ORG_ID, lat: home.lat, lng: home.lng, label: home.label.slice(0, 120) };
  if (isDemoMode) {
    demo.put(COLLECTIONS.mileageHomes, uid, payload);
    return;
  }
  await setDoc(doc(getDb(), COLLECTIONS.mileageHomes, uid), payload);
}
