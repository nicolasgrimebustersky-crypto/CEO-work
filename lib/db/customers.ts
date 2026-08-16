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
import {
  advanceOnly,
  isPipelineStage,
  PIPELINE_LABEL,
  stageForStatus,
  syncStatusToStage,
  type PipelineStage,
} from "@/lib/pipeline";
import { CUSTOMER_STATUSES, LEAD_SOURCES, SERVICE_TYPES } from "@/lib/types";
import type {
  Author,
  Customer,
  CustomerStatus,
  LeadSource,
  Note,
  NoteKind,
  ServiceType,
} from "@/lib/types";

function asStatus(value: unknown): CustomerStatus {
  return CUSTOMER_STATUSES.includes(value as CustomerStatus)
    ? (value as CustomerStatus)
    : "lead";
}

function asServiceTypes(value: unknown): ServiceType[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ServiceType =>
    SERVICE_TYPES.includes(item as ServiceType),
  );
}

function asNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is DocumentData => typeof item === "object" && item !== null)
    .map((item, index) => ({
      id: typeof item.id === "string" ? item.id : `note-${index}`,
      text: typeof item.text === "string" ? item.text : "",
      kind: (typeof item.kind === "string" ? item.kind : "note") as NoteKind,
      authorUid: typeof item.authorUid === "string" ? item.authorUid : "",
      authorName: typeof item.authorName === "string" ? item.authorName : "Unknown",
      createdAt: item.createdAt instanceof Timestamp ? item.createdAt : Timestamp.now(),
    }))
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
}

export function toCustomer(snap: QueryDocumentSnapshot<DocumentData>): Customer {
  const data = snap.data();
  return {
    id: snap.id,
    firstName: typeof data.firstName === "string" ? data.firstName : "",
    lastName: typeof data.lastName === "string" ? data.lastName : "",
    phone: typeof data.phone === "string" ? data.phone : "",
    email: typeof data.email === "string" ? data.email : "",
    address: typeof data.address === "string" ? data.address : "",
    lat: typeof data.lat === "number" ? data.lat : 0,
    lng: typeof data.lng === "number" ? data.lng : 0,
    status: asStatus(data.status),
    notes: asNotes(data.notes),
    tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : [],
    serviceTypes: asServiceTypes(data.serviceTypes),
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
    lastContactedAt:
      data.lastContactedAt instanceof Timestamp ? data.lastContactedAt : null,
    lastContactedBy: typeof data.lastContactedBy === "string" ? data.lastContactedBy : null,
    lastContactedByName:
      typeof data.lastContactedByName === "string" ? data.lastContactedByName : null,
    lifetimeValue: typeof data.lifetimeValue === "number" ? data.lifetimeValue : 0,
    // Records created before the pipeline existed default to the first stage.
    pipelineStage: isPipelineStage(data.pipelineStage) ? data.pipelineStage : "new_lead",
    pipelineChangedAt:
      data.pipelineChangedAt instanceof Timestamp ? data.pipelineChangedAt : null,
    pipelineValue: typeof data.pipelineValue === "number" ? data.pipelineValue : 0,
    source: LEAD_SOURCES.includes(data.source as LeadSource)
      ? (data.source as LeadSource)
      : "door_knock",
    sourceLeadId: typeof data.sourceLeadId === "string" ? data.sourceLeadId : null,
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    updatedByName: typeof data.updatedByName === "string" ? data.updatedByName : null,
  };
}

export function subscribeCustomers(
  onChange: (customers: Customer[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<Customer>(COLLECTIONS.customers, (items) =>
      onChange([...items].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())),
    );
  }
  const q = query(collection(getDb(), COLLECTIONS.customers), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map(toCustomer)),
    (error) => onError?.(error),
  );
}

export function subscribeCustomer(
  id: string,
  onChange: (customer: Customer | null) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) return demo.subscribeDoc<Customer>(COLLECTIONS.customers, id, onChange);
  return onSnapshot(
    doc(getDb(), COLLECTIONS.customers, id),
    (snap) =>
      onChange(
        snap.exists() ? toCustomer(snap as QueryDocumentSnapshot<DocumentData>) : null,
      ),
    (error) => onError?.(error),
  );
}

function makeNote(text: string, kind: NoteKind, author: Author): Note {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    kind,
    authorUid: author.uid,
    authorName: author.displayName,
    // serverTimestamp() is not allowed inside an array element, so the client
    // clock stamps notes. Both phones are on network time; drift is seconds.
    createdAt: Timestamp.now(),
  };
}

export interface NewCustomerInput {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  lat: number;
  lng: number;
  status: CustomerStatus;
  serviceTypes: ServiceType[];
  tags: string[];
  note: string;
  source?: LeadSource;
  sourceLeadId?: string | null;
}

export async function createCustomer(
  input: NewCustomerInput,
  author: Author,
): Promise<string> {
  const notes = input.note.trim() ? [makeNote(input.note.trim(), "note", author)] : [];
  const payload = {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    address: input.address.trim(),
    lat: input.lat,
    lng: input.lng,
    status: input.status,
    notes,
    tags: input.tags,
    serviceTypes: input.serviceTypes,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    lastContactedAt: serverTimestamp(),
    lastContactedBy: author.uid,
    lastContactedByName: author.displayName,
    lifetimeValue: 0,
    pipelineStage: "new_lead" satisfies PipelineStage,
    pipelineChangedAt: serverTimestamp(),
    pipelineValue: 0,
    source: input.source ?? "door_knock",
    sourceLeadId: input.sourceLeadId ?? null,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  if (isDemoMode) return demo.add(COLLECTIONS.customers, payload);
  const ref = await addDoc(collection(getDb(), COLLECTIONS.customers), payload);
  return ref.id;
}

/**
 * Every write goes through here so demo mode only has to replace the
 * persistence step, not the logic that decides what to persist.
 */
async function writeCustomer(id: string, patch: Record<string, unknown>): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTIONS.customers, id, patch);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTIONS.customers, id), patch);
}

/**
 * Moves a lead to a stage, records it on the timeline, and keeps the map pin in
 * step. This is the only way the stage should ever change — writing the field
 * directly skips the note and the pin sync.
 */
export async function setPipelineStage(
  customer: Customer,
  stage: PipelineStage,
  author: Author,
  options: { value?: number; reason?: string } = {},
): Promise<void> {
  if (customer.pipelineStage === stage && options.value === undefined) return;

  const patch: Record<string, unknown> = {
    pipelineStage: stage,
    pipelineChangedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  if (options.value !== undefined) patch.pipelineValue = options.value;

  if (customer.pipelineStage !== stage) {
    const note = makeNote(
      options.reason ??
        `Moved from ${PIPELINE_LABEL[customer.pipelineStage]} to ${PIPELINE_LABEL[stage]}`,
      "stage_change",
      author,
    );
    patch.notes = [...customer.notes, note];

    const nextStatus = syncStatusToStage(stage, customer.status);
    if (nextStatus) patch.status = nextStatus;
  }

  await writeCustomer(customer.id, patch);
}

/**
 * Advances a lead in response to something that happened — a quote going out,
 * a job being booked. Never drags it backwards; see advanceOnly().
 */
export async function advancePipeline(
  customer: Customer,
  candidate: PipelineStage,
  author: Author,
  options: { value?: number; reason?: string } = {},
): Promise<void> {
  const target = advanceOnly(customer.pipelineStage, candidate);
  if (target === customer.pipelineStage && options.value === undefined) return;
  await setPipelineStage(customer, target, author, options);
}

export type CustomerPatch = Partial<
  Pick<
    Customer,
    | "firstName"
    | "lastName"
    | "phone"
    | "email"
    | "address"
    | "lat"
    | "lng"
    | "status"
    | "tags"
    | "serviceTypes"
    | "lifetimeValue"
  >
>;

/**
 * Every mutation stamps updatedBy/updatedAt. Conflicts resolve last-write-wins
 * (Firestore's default) and the stamp is what the UI shows so the other person
 * can see their edit was replaced and by whom.
 */
export async function updateCustomer(
  id: string,
  patch: CustomerPatch,
  author: Author,
): Promise<void> {
  await writeCustomer(id, {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

/**
 * Notes are appended client-side rather than with arrayUnion because arrayUnion
 * de-duplicates by deep equality and cannot express "newest first" ordering;
 * the array is small (one customer's history) so rewriting it is cheap.
 */
export async function addNote(
  customer: Customer,
  text: string,
  kind: NoteKind,
  author: Author,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const note = makeNote(trimmed, kind, author);
  await writeCustomer(customer.id, {
    notes: [...customer.notes, note],
    lastContactedAt: serverTimestamp(),
    lastContactedBy: author.uid,
    lastContactedByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

export async function changeStatus(
  customer: Customer,
  status: CustomerStatus,
  author: Author,
): Promise<void> {
  if (customer.status === status) return;
  const note = makeNote(
    `Status changed from ${customer.status.replace(/_/g, " ")} to ${status.replace(/_/g, " ")}`,
    "status_change",
    author,
  );
  const patch: Record<string, unknown> = {
    status,
    notes: [...customer.notes, note],
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  // Marking a pin "not interested" or "do not knock" closes the deal too —
  // otherwise it sits in an open column forever asking to be chased.
  const closedStage = stageForStatus(status);
  if (closedStage && customer.pipelineStage !== closedStage) {
    patch.pipelineStage = closedStage;
    patch.pipelineChangedAt = serverTimestamp();
  }

  await writeCustomer(customer.id, patch);
}

/**
 * Places a record that arrived without coordinates — an import, or a lead form
 * with an address but no pin. Deliberately narrower than updateCustomer: a
 * bulk backfill running over the whole book should not be able to write
 * anything except the position.
 */
export async function setCoordinates(
  id: string,
  lat: number,
  lng: number,
  author: Author,
): Promise<void> {
  // The stamps are not optional: firestore.rules refuses any update that does
  // not carry a fresh updatedBy/updatedAt from the caller.
  await writeCustomer(id, {
    lat,
    lng,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

export async function markContacted(customer: Customer, author: Author): Promise<void> {
  await writeCustomer(customer.id, {
    lastContactedAt: serverTimestamp(),
    lastContactedBy: author.uid,
    lastContactedByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

export async function deleteCustomer(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTIONS.customers, id);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTIONS.customers, id));
}
