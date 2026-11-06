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
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useEffect, useState } from "react";

import {
  asPaySettings,
  CLASSIFICATIONS,
  PAY_BASES,
  type Classification,
  type PayBasis,
  type PayRun,
  type PaySettings,
  type PersonPay,
  type TimeEdit,
  type W9File,
} from "@/lib/crewPay";
import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb, getFirebaseStorage } from "@/lib/firebase";
import { DEFAULT_ORG_ID } from "@/lib/org";
import type { Author } from "@/lib/types";

/**
 * Crew pay, in three places, each with its own readers (firestore.rules):
 *
 *   ownerSettings/pay  rates, W-2/1099 and W-9s per person — the owner only.
 *   timeEdits          hour corrections — the owner, and the person they're for.
 *   payRuns            what was paid, per person per period — the owner, and
 *                      the person paid. Only the owner writes them.
 */
const PAY_DOC = "pay";

/* ------------------------------------------------------------ settings */

/**
 * Owner screens only: pass `enabled` false for anyone else, who can't read
 * it (the rules refuse) and has no business asking.
 */
export function usePaySettings(enabled = true): PaySettings {
  const [settings, setSettings] = useState<PaySettings>({ people: {} });
  useEffect(() => {
    if (!enabled) return;
    if (isDemoMode) {
      return demo.subscribe<Record<string, unknown>>(COLLECTIONS.ownerSettings, (rows) =>
        setSettings(asPaySettings(rows.find((r) => r.id === PAY_DOC))),
      );
    }
    return onSnapshot(
      doc(getDb(), COLLECTIONS.ownerSettings, PAY_DOC),
      (snap) => setSettings(asPaySettings(snap.data())),
      () => setSettings({ people: {} }),
    );
  }, [enabled]);
  return settings;
}

/** Saves one person's rate, classification and W-9, leaving everyone else's alone. */
export async function savePersonPay(uid: string, person: PersonPay, author: Author): Promise<void> {
  const entry = {
    classification: person.classification,
    basis: person.basis,
    rate: person.rate,
    w9: person.w9,
  };
  const payload = {
    orgId: DEFAULT_ORG_ID,
    people: { [uid]: entry },
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) {
    const existing = demo.get<Record<string, unknown>>(COLLECTIONS.ownerSettings, PAY_DOC) ?? {};
    const people = { ...((existing.people as Record<string, unknown>) ?? {}), [uid]: entry };
    demo.put(COLLECTIONS.ownerSettings, PAY_DOC, { ...existing, ...payload, people });
    return;
  }
  // merge: true merges maps key by key, so this writes only people[uid].
  await setDoc(doc(getDb(), COLLECTIONS.ownerSettings, PAY_DOC), payload, { merge: true });
}

/** A W-9 holds a tax ID: owner-only storage, never a share link. */
export async function uploadW9(uid: string, file: File): Promise<Omit<W9File, "receivedOn">> {
  const isPdf = file.type === "application/pdf";
  const contentType = isPdf ? "application/pdf" : file.type || "image/jpeg";
  const path = `w9/${uid}/w9-${Date.now()}.${isPdf ? "pdf" : "jpg"}`;
  if (isDemoMode) return { url: URL.createObjectURL(file), path, contentType };
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, file, { contentType });
  return { url: await getDownloadURL(storageRef), path, contentType };
}

export async function removeW9File(file: W9File): Promise<void> {
  if (isDemoMode) return;
  try {
    await deleteObject(ref(getFirebaseStorage(), file.path));
  } catch {
    // Already gone.
  }
}

/* ---------------------------------------------------- time corrections */

const EDITS = COLLECTIONS.timeEdits;

export interface StoredTimeEdit extends TimeEdit {
  jobId: string | null;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  approvedByName: string | null;
}

export function toTimeEdit(id: string, data: DocumentData): StoredTimeEdit {
  return {
    id,
    uid: typeof data.uid === "string" ? data.uid : "",
    date: typeof data.date === "string" ? data.date : "1970-01-01",
    minutes: typeof data.minutes === "number" && Number.isFinite(data.minutes) ? data.minutes : 0,
    reason: typeof data.reason === "string" ? data.reason : "",
    approved: data.approved === true,
    jobId: typeof data.jobId === "string" ? data.jobId : null,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
    approvedByName: typeof data.approvedByName === "string" ? data.approvedByName : null,
  };
}

const newestEdits = (items: StoredTimeEdit[]) =>
  [...items].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.toMillis() - a.createdAt.toMillis());

/** The owner sees everyone's corrections; anyone else their own. */
export function subscribeTimeEdits(
  viewer: { uid: string; isOwner: boolean },
  onChange: (edits: StoredTimeEdit[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<Record<string, unknown>>(EDITS, (rows) =>
      onChange(newestEdits(rows.map((r) => toTimeEdit(String(r.id), r)).filter((e) => viewer.isOwner || e.uid === viewer.uid))),
    );
  }
  const base = collection(getDb(), EDITS);
  const q = viewer.isOwner ? query(base) : query(base, where("uid", "==", viewer.uid));
  return onSnapshot(
    q,
    (snap) => onChange(newestEdits(snap.docs.map((d) => toTimeEdit(d.id, d.data())))),
    (error) => onError?.(error),
  );
}

/**
 * Logs a correction. The owner's count straight away; a crew member's wait
 * for the owner's approval (and the rules refuse one that claims otherwise).
 */
export async function addTimeEdit(
  edit: { uid: string; date: string; minutes: number; reason: string; jobId?: string | null },
  author: Author,
  isOwner: boolean,
): Promise<void> {
  const payload = {
    orgId: DEFAULT_ORG_ID,
    uid: edit.uid,
    date: edit.date,
    minutes: Math.round(edit.minutes),
    reason: edit.reason.trim().slice(0, 200),
    jobId: edit.jobId ?? null,
    approved: isOwner,
    approvedBy: isOwner ? author.uid : null,
    approvedByName: isOwner ? author.displayName : null,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
  };
  if (isDemoMode) {
    demo.add(EDITS, payload);
    return;
  }
  await setDoc(doc(collection(getDb(), EDITS)), payload);
}

/** Owner only. */
export async function approveTimeEdit(id: string, author: Author): Promise<void> {
  const patch = {
    approved: true,
    approvedBy: author.uid,
    approvedByName: author.displayName,
    approvedAt: serverTimestamp(),
  };
  if (isDemoMode) {
    demo.update(EDITS, id, patch);
    return;
  }
  await updateDoc(doc(getDb(), EDITS, id), patch);
}

/** The owner rejects or removes one; a crew member can withdraw their own while it waits. */
export async function deleteTimeEdit(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(EDITS, id);
    return;
  }
  await deleteDoc(doc(getDb(), EDITS, id));
}

/* -------------------------------------------------------- paid records */

const RUNS = COLLECTIONS.payRuns;

export const PAY_METHODS = ["cash", "check", "venmo", "bank", "payroll", "other"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  cash: "Cash",
  check: "Check",
  venmo: "Venmo",
  bank: "Bank transfer",
  payroll: "Payroll service",
  other: "Other",
};

export interface StoredPayRun extends PayRun {
  hours: number;
  jobs: number;
  basis: PayBasis;
  rate: number;
  method: PayMethod;
  notes: string;
  createdByName: string;
}

export function toPayRun(id: string, data: DocumentData): StoredPayRun {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id,
    uid: str(data.uid),
    name: str(data.name) || "Crew member",
    periodStart: str(data.periodStart),
    periodEnd: str(data.periodEnd),
    gross: num(data.gross),
    classification: (CLASSIFICATIONS as readonly string[]).includes(data.classification)
      ? (data.classification as Classification)
      : "1099",
    paidOn: str(data.paidOn),
    hours: num(data.hours),
    jobs: num(data.jobs),
    basis: (PAY_BASES as readonly string[]).includes(data.basis) ? (data.basis as PayBasis) : "hourly",
    rate: num(data.rate),
    method: (PAY_METHODS as readonly string[]).includes(data.method) ? (data.method as PayMethod) : "other",
    notes: str(data.notes),
    createdByName: str(data.createdByName),
  };
}

const newestRuns = (items: StoredPayRun[]) =>
  [...items].sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.name.localeCompare(b.name));

/** The owner sees everyone's pay; anyone else their own. */
export function subscribePayRuns(
  viewer: { uid: string; isOwner: boolean },
  onChange: (runs: StoredPayRun[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<Record<string, unknown>>(RUNS, (rows) =>
      onChange(newestRuns(rows.map((r) => toPayRun(String(r.id), r)).filter((r) => viewer.isOwner || r.uid === viewer.uid))),
    );
  }
  const base = collection(getDb(), RUNS);
  const q = viewer.isOwner ? query(base) : query(base, where("uid", "==", viewer.uid));
  return onSnapshot(
    q,
    (snap) => onChange(newestRuns(snap.docs.map((d) => toPayRun(d.id, d.data())))),
    (error) => onError?.(error),
  );
}

export interface NewPayRun {
  uid: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  jobs: number;
  basis: PayBasis;
  rate: number;
  gross: number;
  classification: Classification;
  paidOn: string;
  method: PayMethod;
  notes: string;
}

/**
 * Owner only. One record per person per period: the id is derived from
 * both, so a second tap (or a second phone) corrects the record rather than
 * paying twice.
 */
export async function recordPayRun(run: NewPayRun, author: Author): Promise<void> {
  const id = `${run.uid}_${run.periodStart}`.replace(/[^A-Za-z0-9_-]/g, "_");
  const payload = {
    orgId: DEFAULT_ORG_ID,
    uid: run.uid,
    name: run.name.trim().slice(0, 80) || "Crew member",
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    hours: Math.round(run.hours * 100) / 100,
    jobs: Math.round(run.jobs),
    basis: run.basis,
    rate: run.rate,
    gross: Math.round(run.gross * 100) / 100,
    classification: run.classification,
    paidOn: run.paidOn,
    method: run.method,
    notes: run.notes.trim().slice(0, 500),
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) {
    demo.put(RUNS, id, payload);
    return;
  }
  await setDoc(doc(getDb(), RUNS, id), payload);
}

export async function deletePayRun(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(RUNS, id);
    return;
  }
  await deleteDoc(doc(getDb(), RUNS, id));
}
