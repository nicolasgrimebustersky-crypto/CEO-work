"use client";

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  type DocumentData,
} from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { asEquipment, type Equipment, type LogEntry, type MaintenanceTask, type Meter } from "@/lib/maintenance";
import { DEFAULT_ORG_ID } from "@/lib/org";
import type { Author } from "@/lib/types";

/**
 * Equipment and its service log (lib/maintenance.ts works out what's due).
 * Everyone on the crew reads both and can log work — whoever changed the
 * oil should be the one to say so. Only the owner deletes equipment.
 */
const EQUIPMENT = COLLECTIONS.equipment;
const LOG = COLLECTIONS.maintenanceLog;

export function subscribeEquipment(onChange: (items: Equipment[]) => void, onError?: (e: Error) => void): () => void {
  const sort = (items: Equipment[]) => [...items].sort((a, b) => a.name.localeCompare(b.name));
  if (isDemoMode) {
    return demo.subscribe<Record<string, unknown>>(EQUIPMENT, (rows) => onChange(sort(rows.map((r) => asEquipment(String(r.id), r)))));
  }
  return onSnapshot(
    query(collection(getDb(), EQUIPMENT)),
    (snap) => onChange(sort(snap.docs.map((d) => asEquipment(d.id, d.data())))),
    (error) => onError?.(error),
  );
}

export function newTaskId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Creates (no id) or replaces a piece of equipment's name, meter and tasks. Returns its id. */
export async function saveEquipment(
  item: { id?: string; name: string; meter: Meter; tasks: MaintenanceTask[] },
  author: Author,
): Promise<string> {
  const tasks = item.tasks.slice(0, 20).map((t) => ({
    id: t.id,
    what: t.what.trim().slice(0, 80),
    everyDays: t.everyDays && t.everyDays > 0 ? Math.round(t.everyDays) : null,
    everyUnits: item.meter !== "none" && t.everyUnits && t.everyUnits > 0 ? t.everyUnits : null,
  }));
  const fields = {
    orgId: DEFAULT_ORG_ID,
    name: item.name.trim().slice(0, 60),
    meter: item.meter,
    tasks,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (item.id) {
    if (isDemoMode) {
      demo.update(EQUIPMENT, item.id, fields);
      return item.id;
    }
    await setDoc(doc(getDb(), EQUIPMENT, item.id), fields, { merge: true });
    return item.id;
  }
  const payload = {
    orgId: DEFAULT_ORG_ID,
    name: fields.name,
    meter: fields.meter,
    tasks,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) return demo.add(EQUIPMENT, payload);
  const ref = doc(collection(getDb(), EQUIPMENT));
  await setDoc(ref, payload);
  return ref.id;
}

/** Owner only. The log entries stay, as history. */
export async function deleteEquipment(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(EQUIPMENT, id);
    return;
  }
  await deleteDoc(doc(getDb(), EQUIPMENT, id));
}

/* ------------------------------------------------------------- the log */

export interface StoredLogEntry extends LogEntry {
  note: string;
  expenseId: string | null;
  createdBy: string;
  createdByName: string;
}

export function toLogEntry(id: string, data: DocumentData): StoredLogEntry {
  const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
  return {
    id,
    equipmentId: typeof data.equipmentId === "string" ? data.equipmentId : "",
    date: typeof data.date === "string" ? data.date : "1970-01-01",
    taskIds: Array.isArray(data.taskIds) ? data.taskIds.filter((x: unknown): x is string => typeof x === "string") : [],
    reading: typeof data.reading === "number" && Number.isFinite(data.reading) ? data.reading : null,
    at: createdAt,
    note: typeof data.note === "string" ? data.note : "",
    expenseId: typeof data.expenseId === "string" ? data.expenseId : null,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
  };
}

export function subscribeMaintenanceLog(onChange: (items: StoredLogEntry[]) => void, onError?: (e: Error) => void): () => void {
  const sort = (items: StoredLogEntry[]) => [...items].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  if (isDemoMode) {
    return demo.subscribe<Record<string, unknown>>(LOG, (rows) => onChange(sort(rows.map((r) => toLogEntry(String(r.id), r)))));
  }
  return onSnapshot(
    query(collection(getDb(), LOG)),
    (snap) => onChange(sort(snap.docs.map((d) => toLogEntry(d.id, d.data())))),
    (error) => onError?.(error),
  );
}

export interface NewLogEntry {
  equipmentId: string;
  date: string;
  taskIds: string[];
  reading: number | null;
  note?: string;
  /** Set when the entry comes from a repair expense, so re-saving that expense updates this entry. */
  expenseId?: string | null;
}

/** Logs work done and/or a meter reading. */
export async function logMaintenance(entry: NewLogEntry, author: Author): Promise<void> {
  const payload = {
    orgId: DEFAULT_ORG_ID,
    equipmentId: entry.equipmentId,
    date: entry.date,
    taskIds: entry.taskIds.slice(0, 20),
    reading: entry.reading != null && Number.isFinite(entry.reading) && entry.reading >= 0 ? Math.round(entry.reading * 10) / 10 : null,
    note: (entry.note ?? "").trim().slice(0, 200),
    expenseId: entry.expenseId ?? null,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
  };
  // One entry per expense: the id comes from the expense, so editing the
  // expense corrects its entry rather than adding a second.
  const id = entry.expenseId ? `exp_${entry.expenseId.replace(/[^A-Za-z0-9_-]/g, "_")}` : null;
  if (isDemoMode) {
    if (id) demo.put(LOG, id, payload);
    else demo.add(LOG, payload);
    return;
  }
  await setDoc(id ? doc(getDb(), LOG, id) : doc(collection(getDb(), LOG)), payload);
}

export async function deleteLogEntry(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(LOG, id);
    return;
  }
  await deleteDoc(doc(getDb(), LOG, id));
}

/** Removes the entry an expense made, when the expense no longer says it was service work. */
export async function deleteExpenseLogEntry(expenseId: string): Promise<void> {
  const id = `exp_${expenseId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  if (isDemoMode) {
    demo.remove(LOG, id);
    return;
  }
  try {
    await deleteDoc(doc(getDb(), LOG, id));
  } catch {
    // Not there, or not this person's to remove.
  }
}
