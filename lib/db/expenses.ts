"use client";

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  PROOF_KINDS,
  isExpenseDate,
  type ExpenseCategory,
  type ExpenseFields,
  type PaymentMethod,
  type ProofKind,
  type ReceiptFile,
} from "@/lib/expenses";
import { COLLECTIONS, getDb, getFirebaseStorage } from "@/lib/firebase";
import { asOrgId, DEFAULT_ORG_ID } from "@/lib/org";
import type { Author } from "@/lib/types";

import { downscale } from "./photos";

const COLLECTION = COLLECTIONS.expenses;

export interface Expense extends ExpenseFields {
  id: string;
  orgId: string;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  updatedAt: Timestamp | null;
  updatedByName: string | null;
}

function asReceipt(value: unknown): ReceiptFile | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.url !== "string" || typeof r.path !== "string") return null;
  return {
    url: r.url,
    path: r.path,
    contentType: typeof r.contentType === "string" ? r.contentType : "image/jpeg",
  };
}

/** A stored expense, with anything malformed read as the safest thing it can mean. */
export function toExpense(id: string, data: DocumentData): Expense {
  const receipt = asReceipt(data.receipt);
  const proof = PROOF_KINDS.includes(data.proof) ? (data.proof as ProofKind) : "in_person";
  return {
    id,
    orgId: asOrgId(data.orgId),
    date: isExpenseDate(data.date) ? data.date : "1970-01-01",
    amount: typeof data.amount === "number" && Number.isFinite(data.amount) ? data.amount : 0,
    category: EXPENSE_CATEGORIES.includes(data.category)
      ? (data.category as ExpenseCategory)
      : "other",
    vendor: typeof data.vendor === "string" ? data.vendor : "",
    forWhat: typeof data.forWhat === "string" ? data.forWhat : "",
    paymentMethod: PAYMENT_METHODS.includes(data.paymentMethod)
      ? (data.paymentMethod as PaymentMethod)
      : "other",
    // A "receipt" expense whose file is missing is not backed by a receipt.
    proof: proof === "receipt" && !receipt ? "in_person" : proof,
    notes: typeof data.notes === "string" ? data.notes : "",
    receipt,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
    updatedByName: typeof data.updatedByName === "string" ? data.updatedByName : null,
  };
}

/** Newest first: by the day it was spent, then by when it was logged. */
function sorted(items: Expense[]): Expense[] {
  return [...items].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.toMillis() - a.createdAt.toMillis(),
  );
}

/**
 * The owner sees every expense; anyone else only their own. The rules enforce
 * the same split, and a Firestore list query must be one the rules can prove
 * allowed, so a crew member's query names them.
 */
export function subscribeExpenses(
  viewer: { uid: string; isOwner: boolean },
  onChange: (expenses: Expense[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<Record<string, unknown>>(COLLECTION, (rows) =>
      onChange(
        sorted(
          rows
            .map((row) => toExpense(String(row.id), row))
            .filter((e) => viewer.isOwner || e.createdBy === viewer.uid),
        ),
      ),
    );
  }
  const base = collection(getDb(), COLLECTION);
  // No orderBy: with the where clause it would need a composite index, and
  // the list is sorted here anyway.
  const q = viewer.isOwner ? query(base) : query(base, where("createdBy", "==", viewer.uid));
  return onSnapshot(
    q,
    (snap) =>
      onChange(sorted(snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => toExpense(d.id, d.data())))),
    (error) => onError?.(error),
  );
}

/** A fresh id, so a receipt can be uploaded under it before the record exists. */
export function newExpenseId(): string {
  if (isDemoMode) return `demo-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  return doc(collection(getDb(), COLLECTION)).id;
}

/**
 * Uploads a receipt photo (downscaled like job photos) or PDF. The path must
 * match storage.rules: expenses/{ownerUid}/{expenseId}/{fileName}, where the
 * owner is whoever the expense belongs to — storage.rules lets that person
 * and the business owner in, and nobody else.
 */
export async function uploadReceipt(ownerUid: string, expenseId: string, file: File): Promise<ReceiptFile> {
  const isPdf = file.type === "application/pdf";
  const blob = isPdf ? file : await downscale(file);
  const contentType = isPdf ? "application/pdf" : blob.type || "image/jpeg";
  const name = `receipt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.${isPdf ? "pdf" : "jpg"}`;
  const path = `expenses/${ownerUid}/${expenseId}/${name}`;

  if (isDemoMode) return { url: URL.createObjectURL(blob), path, contentType };

  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, blob, { contentType });
  return { url: await getDownloadURL(storageRef), path, contentType };
}

/** Removes a receipt file. Best-effort: an orphaned file is cheap. */
export async function removeReceiptFile(receipt: ReceiptFile): Promise<void> {
  if (isDemoMode) {
    if (receipt.url.startsWith("blob:")) URL.revokeObjectURL(receipt.url);
    return;
  }
  try {
    await deleteObject(ref(getFirebaseStorage(), receipt.path));
  } catch {
    // Already gone, or no longer allowed. The record is what the screen reads.
  }
}

function fieldsPayload(fields: ExpenseFields): Record<string, unknown> {
  return {
    date: fields.date,
    amount: fields.amount,
    category: fields.category,
    vendor: fields.vendor.trim(),
    forWhat: fields.forWhat.trim(),
    paymentMethod: fields.paymentMethod,
    proof: fields.proof,
    notes: fields.notes.trim(),
    receipt: fields.receipt,
  };
}

export async function createExpense(id: string, fields: ExpenseFields, author: Author): Promise<void> {
  const payload = {
    ...fieldsPayload(fields),
    orgId: DEFAULT_ORG_ID,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) {
    demo.put(COLLECTION, id, payload);
    return;
  }
  await setDoc(doc(getDb(), COLLECTION, id), payload);
}

export async function updateExpense(id: string, fields: ExpenseFields, author: Author): Promise<void> {
  const patch = {
    ...fieldsPayload(fields),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) {
    demo.update(COLLECTION, id, patch);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, id), patch);
}

export async function deleteExpense(expense: Expense): Promise<void> {
  if (isDemoMode) demo.remove(COLLECTION, expense.id);
  else await deleteDoc(doc(getDb(), COLLECTION, expense.id));
  // The record first: a record pointing at a deleted file shows a broken image.
  if (expense.receipt) await removeReceiptFile(expense.receipt);
}
