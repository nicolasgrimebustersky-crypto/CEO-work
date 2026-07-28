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

import { COLLECTIONS, getDb } from "@/lib/firebase";
import { CUSTOMER_STATUSES, SERVICE_TYPES } from "@/lib/types";
import type {
  Author,
  Customer,
  CustomerStatus,
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
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    updatedByName: typeof data.updatedByName === "string" ? data.updatedByName : null,
  };
}

export function subscribeCustomers(
  onChange: (customers: Customer[]) => void,
  onError?: (error: Error) => void,
): () => void {
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
}

export async function createCustomer(
  input: NewCustomerInput,
  author: Author,
): Promise<string> {
  const notes = input.note.trim() ? [makeNote(input.note.trim(), "note", author)] : [];
  const ref = await addDoc(collection(getDb(), COLLECTIONS.customers), {
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
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
  return ref.id;
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
  await updateDoc(doc(getDb(), COLLECTIONS.customers, id), {
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
  await updateDoc(doc(getDb(), COLLECTIONS.customers, customer.id), {
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
  await updateDoc(doc(getDb(), COLLECTIONS.customers, customer.id), {
    status,
    notes: [...customer.notes, note],
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

export async function markContacted(customer: Customer, author: Author): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTIONS.customers, customer.id), {
    lastContactedAt: serverTimestamp(),
    lastContactedBy: author.uid,
    lastContactedByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

export async function deleteCustomer(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), COLLECTIONS.customers, id));
}
