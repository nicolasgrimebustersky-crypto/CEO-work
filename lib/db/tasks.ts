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
} from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { asOrgId, DEFAULT_ORG_ID } from "@/lib/org";
import { MAX_NOTES, MAX_TITLE } from "@/lib/tasks";
import type { Author, Task } from "@/lib/types";

const COLLECTION = COLLECTIONS.tasks;

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;
const stampOrNull = (value: unknown): Timestamp | null =>
  value instanceof Timestamp ? value : null;

/** Every field on `Task`, read defensively: a bad write must not break the list. */
export function asTask(id: string, data: DocumentData): Task {
  return {
    id,
    orgId: asOrgId(data.orgId),
    title: typeof data.title === "string" && data.title ? data.title : "Untitled",
    notes: typeof data.notes === "string" ? data.notes : "",
    dueAt: stampOrNull(data.dueAt),
    customerId: stringOrNull(data.customerId),
    customerName: stringOrNull(data.customerName),
    documentId: stringOrNull(data.documentId),
    assignedTo: stringOrNull(data.assignedTo),
    doneAt: stampOrNull(data.doneAt),
    doneBy: stringOrNull(data.doneBy),
    remindedAt: stampOrNull(data.remindedAt),
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
    updatedAt: stampOrNull(data.updatedAt),
    updatedBy: stringOrNull(data.updatedBy),
    updatedByName: stringOrNull(data.updatedByName),
  };
}

export function subscribeTasks(
  onChange: (tasks: Task[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<Task & DocumentData>(COLLECTION, (items) =>
      onChange(items.map((item) => asTask(item.id, item))),
    );
  }
  return onSnapshot(
    query(collection(getDb(), COLLECTION), orderBy("createdAt", "desc")),
    (snap) => onChange(snap.docs.map((d) => asTask(d.id, d.data()))),
    (error) => onError?.(error),
  );
}

export interface TaskInput {
  title: string;
  notes?: string;
  due: Date | null;
  customerId?: string | null;
  customerName?: string | null;
  documentId?: string | null;
  assignedTo?: string | null;
}

const stamp = (author: Author) => ({
  updatedAt: serverTimestamp(),
  updatedBy: author.uid,
  updatedByName: author.displayName,
});

export async function createTask(input: TaskInput, author: Author): Promise<string> {
  const payload = {
    title: input.title.trim().slice(0, MAX_TITLE),
    notes: (input.notes ?? "").slice(0, MAX_NOTES),
    dueAt: input.due ? Timestamp.fromDate(input.due) : null,
    customerId: input.customerId ?? null,
    customerName: input.customerName ?? null,
    documentId: input.documentId ?? null,
    assignedTo: input.assignedTo ?? null,
    doneAt: null,
    doneBy: null,
    remindedAt: null,
    orgId: DEFAULT_ORG_ID,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    ...stamp(author),
  };

  if (isDemoMode) return demo.add(COLLECTION, payload);
  const ref = await addDoc(collection(getDb(), COLLECTION), payload);
  return ref.id;
}

async function write(id: string, patch: Record<string, unknown>): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTION, id, patch);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, id), patch);
}

/**
 * Edits what it says, who has it and when.
 *
 * A new due date clears the reminder stamp, so a follow-up pushed to Friday
 * buzzes again on Friday. Without that, snoozing would silence it for good.
 */
export async function updateTask(
  id: string,
  patch: Partial<Omit<TaskInput, "due">> & { due?: Date | null },
  author: Author,
): Promise<void> {
  const next: Record<string, unknown> = { ...stamp(author) };
  if (patch.title !== undefined) next.title = patch.title.trim().slice(0, MAX_TITLE);
  if (patch.notes !== undefined) next.notes = patch.notes.slice(0, MAX_NOTES);
  if (patch.customerId !== undefined) next.customerId = patch.customerId;
  if (patch.customerName !== undefined) next.customerName = patch.customerName;
  if (patch.documentId !== undefined) next.documentId = patch.documentId;
  if (patch.assignedTo !== undefined) next.assignedTo = patch.assignedTo;
  if (patch.due !== undefined) {
    next.dueAt = patch.due ? Timestamp.fromDate(patch.due) : null;
    next.remindedAt = null;
  }
  await write(id, next);
}

export async function setTaskDone(id: string, done: boolean, author: Author): Promise<void> {
  await write(id, {
    doneAt: done ? serverTimestamp() : null,
    doneBy: done ? author.uid : null,
    ...stamp(author),
  });
}

export async function deleteTask(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTION, id);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTION, id));
}
