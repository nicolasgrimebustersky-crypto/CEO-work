import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import type { LineItem } from "@/lib/documents";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { SERVICE_TYPES } from "@/lib/types";
import type { Author, ServiceType } from "@/lib/types";

const COLLECTION = COLLECTIONS.services;

/**
 * The price book.
 *
 * Nobody sits down to fill one of these in, so it fills itself: every service
 * typed onto an estimate is remembered, and the next estimate offers it back
 * with its wording and its last price. That means the second time you quote a
 * two-storey house wash you get the same description the customer read the
 * first time — which is worth more than the seconds it saves, because it is
 * what makes the paperwork look like it came from a company.
 */
export interface SavedService {
  id: string;
  name: string;
  description: string;
  unitPrice: number;
  serviceType: ServiceType;
  taxable: boolean;
  /** Ranks the picker: what you quote most sits at the top. */
  timesUsed: number;
  lastUsedAt: Timestamp;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  updatedAt: Timestamp | null;
  updatedBy: string | null;
  updatedByName: string | null;
}

/**
 * The key two services are "the same" under.
 *
 * Case and spacing only. Deliberately not fuzzy: "House wash" and "House wash
 * — 2 story" are different jobs at different prices, and silently merging them
 * would overwrite one price with the other.
 */
export function serviceKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function toService(snap: QueryDocumentSnapshot<DocumentData>): SavedService {
  const data = snap.data();
  return {
    id: snap.id,
    name: typeof data.name === "string" ? data.name : "",
    description: typeof data.description === "string" ? data.description : "",
    unitPrice: typeof data.unitPrice === "number" ? data.unitPrice : 0,
    serviceType: SERVICE_TYPES.includes(data.serviceType as ServiceType)
      ? (data.serviceType as ServiceType)
      : "pressure_washing",
    taxable: data.taxable !== false,
    timesUsed: typeof data.timesUsed === "number" ? data.timesUsed : 1,
    lastUsedAt: data.lastUsedAt instanceof Timestamp ? data.lastUsedAt : Timestamp.now(),
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    updatedByName: typeof data.updatedByName === "string" ? data.updatedByName : null,
  };
}

/** Most-used first, then most recent — the order you want in a picker. */
export function rankServices(services: SavedService[]): SavedService[] {
  return [...services].sort(
    (a, b) => b.timesUsed - a.timesUsed || b.lastUsedAt.toMillis() - a.lastUsedAt.toMillis(),
  );
}

export function subscribeServices(
  onChange: (services: SavedService[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<SavedService>(COLLECTION, (items) => onChange(rankServices(items)));
  }
  return onSnapshot(
    query(collection(getDb(), COLLECTION)),
    (snap) => onChange(rankServices(snap.docs.map(toService))),
    (error) => onError?.(error),
  );
}

async function loadAll(): Promise<SavedService[]> {
  if (isDemoMode) return demo.rows<SavedService>(COLLECTION);
  const snap = await getDocs(collection(getDb(), COLLECTION));
  return snap.docs.map(toService);
}

/**
 * Records the services used on a document.
 *
 * Called after a save, and deliberately not awaited by the caller: the
 * estimate is the thing that mattered, and failing to update the price book
 * must never be the reason a quote does not get saved. Errors are swallowed
 * for the same reason.
 */
export async function rememberServices(
  lineItems: LineItem[],
  serviceType: ServiceType,
  author: Author,
): Promise<void> {
  const named = lineItems.filter((item) => item.name.trim() !== "");
  if (named.length === 0) return;

  let existing: SavedService[];
  try {
    existing = await loadAll();
  } catch {
    return;
  }
  const byKey = new Map(existing.map((service) => [serviceKey(service.name), service]));

  // One entry per key even if the same service appears on two lines.
  const seen = new Set<string>();

  for (const item of named) {
    const key = serviceKey(item.name);
    if (seen.has(key)) continue;
    seen.add(key);

    const match = byKey.get(key);
    try {
      if (match) {
        // The latest price wins — that is what you would quote today. A
        // description is only overwritten when the new one has something in
        // it, so re-using a service without retyping its detail keeps it.
        const patch: Record<string, unknown> = {
          unitPrice: item.unitPrice,
          taxable: item.taxable,
          timesUsed: match.timesUsed + 1,
          lastUsedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: author.uid,
          updatedByName: author.displayName,
        };
        if (item.description.trim()) patch.description = item.description.trim();

        if (isDemoMode) demo.update(COLLECTION, match.id, patch);
        else await updateDoc(doc(getDb(), COLLECTION, match.id), patch);
      } else {
        const payload = {
          name: item.name.trim(),
          description: item.description.trim(),
          unitPrice: item.unitPrice,
          serviceType,
          taxable: item.taxable,
          timesUsed: 1,
          lastUsedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          createdBy: author.uid,
          createdByName: author.displayName,
          updatedAt: serverTimestamp(),
          updatedBy: author.uid,
          updatedByName: author.displayName,
        };
        if (isDemoMode) demo.add(COLLECTION, payload);
        else await addDoc(collection(getDb(), COLLECTION), payload);
      }
    } catch {
      // Keep going: one bad line should not stop the rest being remembered.
    }
  }
}

export interface ServicePatch {
  name?: string;
  description?: string;
  unitPrice?: number;
  serviceType?: ServiceType;
  taxable?: boolean;
}

export async function updateService(
  id: string,
  patch: ServicePatch,
  author: Author,
): Promise<void> {
  const payload: Record<string, unknown> = {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) {
    demo.update(COLLECTION, id, payload);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, id), payload);
}

export async function createService(
  input: Required<Omit<ServicePatch, never>>,
  author: Author,
): Promise<string> {
  const payload = {
    name: input.name.trim(),
    description: input.description.trim(),
    unitPrice: input.unitPrice,
    serviceType: input.serviceType,
    taxable: input.taxable,
    timesUsed: 0,
    lastUsedAt: serverTimestamp(),
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

export async function deleteService(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTION, id);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTION, id));
}
