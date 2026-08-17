"use client";

import { FieldValue, Timestamp } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase";
import {
  demoCustomers,
  demoDocuments,
  demoJobs,
  demoNotifications,
  demoKnockRoutes,
  demoServices,
  demoTerritories,
  demoConversations,
  demoChatMessages,
  demoQuotes,
  demoUsers,
  // Imported by alias, not relatively: next.config.ts swaps this module out in
  // a normal build and the alias only matches the "@/…" request.
} from "@/lib/demo/fixtures";

/**
 * The in-memory stand-in for Firestore used by demo mode.
 *
 * It is deliberately shaped like the real thing at the point where the app
 * touches it: a set of collections holding documents with ids, a subscribe
 * call that pushes the whole collection on every change, and merge-on-update
 * writes. That means `lib/db/*` keeps one code path for building payloads and
 * only swaps the final read/write, so the demo exercises the same logic the
 * real app runs rather than a parallel implementation that can drift.
 *
 * Everything lives in a module-level map. A reload starts over, which is the
 * behaviour we want — a shared demo link that accumulates whatever strangers
 * typed into it is worse than one that resets.
 */

export type DemoRow = Record<string, unknown> & { id: string };

const tables = new Map<string, Map<string, DemoRow>>();
const listeners = new Map<string, Set<() => void>>();
let seeded = false;

function tableFor(name: string): Map<string, DemoRow> {
  let table = tables.get(name);
  if (!table) {
    table = new Map();
    tables.set(name, table);
  }
  return table;
}

function seedTable(name: string, rows: DemoRow[]): void {
  const table = tableFor(name);
  for (const row of rows) table.set(row.id, row);
}

function seed(): void {
  if (seeded) return;
  seeded = true;
  // Users are keyed by uid in Firestore, so the row id is the uid.
  seedTable(
    COLLECTIONS.users,
    demoUsers.map((user) => ({ ...user, id: user.uid })),
  );
  seedTable(COLLECTIONS.customers, demoCustomers as unknown as DemoRow[]);
  seedTable(COLLECTIONS.jobs, demoJobs as unknown as DemoRow[]);
  seedTable(COLLECTIONS.quotes, demoQuotes as unknown as DemoRow[]);
  seedTable(COLLECTIONS.notifications, demoNotifications as unknown as DemoRow[]);
  seedTable(COLLECTIONS.documents, demoDocuments as unknown as DemoRow[]);
  seedTable(COLLECTIONS.services, demoServices as unknown as DemoRow[]);
  seedTable(COLLECTIONS.knockRoutes, demoKnockRoutes as unknown as DemoRow[]);
  seedTable(COLLECTIONS.territories, demoTerritories as unknown as DemoRow[]);
  seedTable(COLLECTIONS.conversations, demoConversations as unknown as DemoRow[]);
  seedTable(COLLECTIONS.chatMessages, demoChatMessages as unknown as DemoRow[]);
}

function emit(name: string): void {
  listeners.get(name)?.forEach((notify) => notify());
}

/**
 * Payloads arrive exactly as they would be sent to Firestore, so they can
 * contain `serverTimestamp()` sentinels and Dates. Resolve both to the
 * Timestamps the readers expect.
 */
function resolve(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof FieldValue) out[key] = Timestamp.now();
    else if (value instanceof Date) out[key] = Timestamp.fromDate(value);
    else out[key] = value;
  }
  return out;
}

export function rows<T>(name: string): T[] {
  seed();
  return [...tableFor(name).values()] as T[];
}

export function get<T>(name: string, id: string): T | null {
  seed();
  return (tableFor(name).get(id) as T | undefined) ?? null;
}

/**
 * Fires asynchronously the first time, matching the order things happen with a
 * real listener: the caller finishes setting up, then data arrives.
 */
export function subscribe<T>(name: string, onChange: (items: T[]) => void): () => void {
  const notify = () => onChange(rows<T>(name));

  const set = listeners.get(name) ?? new Set<() => void>();
  listeners.set(name, set);
  set.add(notify);

  const timer = setTimeout(notify, 0);
  return () => {
    clearTimeout(timer);
    set.delete(notify);
  };
}

export function subscribeDoc<T>(
  name: string,
  id: string,
  onChange: (item: T | null) => void,
): () => void {
  return subscribe<unknown>(name, () => onChange(get<T>(name, id)));
}

export function add(name: string, data: Record<string, unknown>): string {
  const id = `demo-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  tableFor(name).set(id, { ...resolve(data), id });
  emit(name);
  return id;
}

/** Shallow merge, like Firestore's updateDoc with top-level field names. */
export function update(name: string, id: string, patch: Record<string, unknown>): void {
  seed();
  const table = tableFor(name);
  const existing = table.get(id);
  if (!existing) return;
  table.set(id, { ...existing, ...resolve(patch), id });
  emit(name);
}

export function remove(name: string, id: string): void {
  seed();
  if (tableFor(name).delete(id)) emit(name);
}
