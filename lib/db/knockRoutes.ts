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
import { orderByNearest, type Point, type Stop } from "@/lib/knock/plan";
import { ROUTE_STATUSES, type Author, type Customer, type KnockRoute, type RouteStatus } from "@/lib/types";

const COLLECTION = COLLECTIONS.knockRoutes;

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function toKnockRoute(snap: QueryDocumentSnapshot<DocumentData>): KnockRoute {
  const data = snap.data();
  const status = ROUTE_STATUSES.includes(data.status as RouteStatus)
    ? (data.status as RouteStatus)
    : "planned";

  return {
    id: snap.id,
    name: typeof data.name === "string" ? data.name : "Untitled route",
    walkDate: data.walkDate instanceof Timestamp ? data.walkDate : null,
    assignedTo: asStringList(data.assignedTo),
    stopIds: asStringList(data.stopIds),
    knockedIds: asStringList(data.knockedIds),
    status,
    notes: typeof data.notes === "string" ? data.notes : "",
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    updatedByName: typeof data.updatedByName === "string" ? data.updatedByName : null,
  };
}

/**
 * Newest first, but unfinished routes ahead of finished ones.
 *
 * What you open this screen for is "what am I walking", not "what did we walk
 * in March" — so a finished route sinks below everything still live no matter
 * how recent it is.
 */
const byUrgency = (a: KnockRoute, b: KnockRoute) => {
  if ((a.status === "done") !== (b.status === "done")) return a.status === "done" ? 1 : -1;
  const aDay = a.walkDate?.toMillis() ?? a.createdAt.toMillis();
  const bDay = b.walkDate?.toMillis() ?? b.createdAt.toMillis();
  return bDay - aDay;
};

export function subscribeKnockRoutes(
  onChange: (routes: KnockRoute[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<KnockRoute>(COLLECTION, (items) =>
      onChange([...items].sort(byUrgency)),
    );
  }
  return onSnapshot(
    query(collection(getDb(), COLLECTION), orderBy("createdAt", "desc")),
    (snap) => onChange(snap.docs.map(toKnockRoute).sort(byUrgency)),
    (error) => onError?.(error),
  );
}

export interface NewRouteInput {
  name: string;
  walkDate: Date | null;
  assignedTo: string[];
  stopIds: string[];
  notes?: string;
}

export async function createKnockRoute(
  input: NewRouteInput,
  author: Author,
): Promise<string> {
  const payload = {
    name: input.name.trim() || "Untitled route",
    walkDate: input.walkDate ? Timestamp.fromDate(input.walkDate) : null,
    assignedTo: input.assignedTo,
    stopIds: input.stopIds,
    knockedIds: [],
    status: "planned" satisfies RouteStatus,
    notes: input.notes ?? "",
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

/** Every write goes through here, so demo mode swaps persistence and nothing else. */
async function writeRoute(id: string, patch: Record<string, unknown>): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTION, id, patch);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, id), patch);
}

function stamped(author: Author, patch: Record<string, unknown>) {
  return {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
}

export async function updateKnockRoute(
  route: KnockRoute,
  patch: {
    name?: string;
    walkDate?: Date | null;
    assignedTo?: string[];
    stopIds?: string[];
    notes?: string;
    status?: RouteStatus;
  },
  author: Author,
): Promise<void> {
  const next: Record<string, unknown> = {};
  if (patch.name !== undefined) next.name = patch.name.trim() || "Untitled route";
  if (patch.walkDate !== undefined) {
    next.walkDate = patch.walkDate ? Timestamp.fromDate(patch.walkDate) : null;
  }
  if (patch.assignedTo !== undefined) next.assignedTo = patch.assignedTo;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.status !== undefined) next.status = patch.status;

  if (patch.stopIds !== undefined) {
    next.stopIds = patch.stopIds;
    // Dropping a stop drops the record of having knocked it. Leaving it behind
    // would let progress read 5 of 4 — the case the planner's own test pins.
    const kept = new Set(patch.stopIds);
    next.knockedIds = route.knockedIds.filter((id) => kept.has(id));
  }

  await writeRoute(route.id, stamped(author, next));
}

/**
 * Marks a door knocked, or un-knocks it.
 *
 * The route moves itself along: knocking the first door means you are out
 * walking, and knocking the last means you are finished. That is the state
 * nobody remembers to set by hand, and a route stuck on "planned" all week
 * tells the other person nothing.
 */
export async function setKnocked(
  route: KnockRoute,
  customerId: string,
  knocked: boolean,
  author: Author,
): Promise<void> {
  const knockedIds = knocked
    ? [...new Set([...route.knockedIds, customerId])]
    : route.knockedIds.filter((id) => id !== customerId);

  const onRoute = knockedIds.filter((id) => route.stopIds.includes(id));
  const status: RouteStatus =
    onRoute.length === 0
      ? "planned"
      : onRoute.length >= route.stopIds.length
        ? "done"
        : "walking";

  await writeRoute(route.id, stamped(author, { knockedIds, status }));
}

/**
 * Re-plans the walking order from wherever you are.
 *
 * A route built by tapping pins comes out in the order you happened to tap
 * them, which is rarely the order you would drive them. This is the button that
 * fixes that, and it is a button rather than something automatic because the
 * crew sometimes want a specific order — the awkward cul-de-sac first, while
 * there is still light.
 */
export async function reorderFromHere(
  route: KnockRoute,
  customersById: Map<string, Customer>,
  from: Point | null,
  author: Author,
): Promise<void> {
  const stops: Stop[] = route.stopIds
    .map((id) => customersById.get(id))
    .filter((customer): customer is Customer => customer !== undefined)
    // A pin with no coordinates cannot be planned around; it keeps its place
    // at the end rather than being dropped from somebody's route.
    .filter((customer) => customer.lat !== 0 || customer.lng !== 0)
    .map((customer) => ({ id: customer.id, lat: customer.lat, lng: customer.lng }));

  const planned = orderByNearest(stops, from).map((stop) => stop.id);
  const unplannable = route.stopIds.filter((id) => !planned.includes(id));

  await updateKnockRoute(route, { stopIds: [...planned, ...unplannable] }, author);
}

export async function deleteKnockRoute(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTION, id);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTION, id));
}

/* --------------------------------------------------------------- reading */

/** Routes this person is on, or that nobody has picked up. */
export function routesFor(routes: KnockRoute[], uid: string | null): KnockRoute[] {
  if (!uid) return routes;
  return routes.filter(
    (route) => route.assignedTo.length === 0 || route.assignedTo.includes(uid),
  );
}

/** Doors already on some other live route, so one is not walked twice. */
export function stopsOnOtherRoutes(routes: KnockRoute[], exceptId: string): Set<string> {
  const taken = new Set<string>();
  for (const route of routes) {
    if (route.id === exceptId || route.status === "done") continue;
    for (const id of route.stopIds) taken.add(id);
  }
  return taken;
}
