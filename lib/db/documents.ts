import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import {
  computeTotals,
  DEFAULT_TAX_RATE_PCT,
  nextNumber,
  statusAfterPayment,
  sumPayments,
  type BusinessDocument,
  type DocumentKind,
  type DocumentStatus,
  type LineItem,
  type Payment,
} from "@/lib/documents";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { SERVICE_TYPES } from "@/lib/types";
import type { Author, Customer, ServiceType } from "@/lib/types";

const COLLECTION = COLLECTIONS.documents;

/**
 * Line items gained a `name` after the first documents were already written,
 * so a stored line may have only `description`. Those are read as the name —
 * which is what that field held at the time — leaving the detail blank rather
 * than showing an unnamed line with a paragraph where its title should be.
 */
function asLineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is DocumentData => typeof item === "object" && item !== null)
    .map((item, index) => {
      const name = typeof item.name === "string" ? item.name : "";
      const description = typeof item.description === "string" ? item.description : "";
      return {
        id: typeof item.id === "string" ? item.id : `li-${index}`,
        name: name || description,
        description: name ? description : "",
        quantity: typeof item.quantity === "number" ? item.quantity : 0,
        unitPrice: typeof item.unitPrice === "number" ? item.unitPrice : 0,
        taxable: item.taxable !== false,
      };
    });
}

function asPayments(value: unknown): Payment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is DocumentData => typeof item === "object" && item !== null)
    .map((item, index) => ({
      id: typeof item.id === "string" ? item.id : `pay-${index}`,
      amount: typeof item.amount === "number" ? item.amount : 0,
      receivedAt: item.receivedAt instanceof Timestamp ? item.receivedAt : Timestamp.now(),
      method: typeof item.method === "string" ? item.method : "",
      recordedBy: typeof item.recordedBy === "string" ? item.recordedBy : "",
      recordedByName: typeof item.recordedByName === "string" ? item.recordedByName : "Unknown",
    }))
    .sort((a, b) => b.receivedAt.toMillis() - a.receivedAt.toMillis());
}

export function toDocument(snap: QueryDocumentSnapshot<DocumentData>): BusinessDocument {
  const data = snap.data();
  const serviceType = SERVICE_TYPES.includes(data.serviceType as ServiceType)
    ? (data.serviceType as ServiceType)
    : "pressure_washing";

  return {
    id: snap.id,
    number: typeof data.number === "string" ? data.number : "",
    kind: data.kind === "invoice" ? "invoice" : "estimate",
    status: (typeof data.status === "string" ? data.status : "draft") as DocumentStatus,
    customerId: typeof data.customerId === "string" ? data.customerId : "",
    customerName: typeof data.customerName === "string" ? data.customerName : "",
    serviceType,
    lineItems: asLineItems(data.lineItems),
    discount: typeof data.discount === "number" ? data.discount : 0,
    taxRatePct: typeof data.taxRatePct === "number" ? data.taxRatePct : DEFAULT_TAX_RATE_PCT,
    subtotal: typeof data.subtotal === "number" ? data.subtotal : 0,
    taxAmount: typeof data.taxAmount === "number" ? data.taxAmount : 0,
    total: typeof data.total === "number" ? data.total : 0,
    payments: asPayments(data.payments),
    amountPaid: typeof data.amountPaid === "number" ? data.amountPaid : 0,
    balanceDue: typeof data.balanceDue === "number" ? data.balanceDue : 0,
    notes: typeof data.notes === "string" ? data.notes : "",
    issuedAt: data.issuedAt instanceof Timestamp ? data.issuedAt : Timestamp.now(),
    dueAt: data.dueAt instanceof Timestamp ? data.dueAt : null,
    sentAt: data.sentAt instanceof Timestamp ? data.sentAt : null,
    settledAt: data.settledAt instanceof Timestamp ? data.settledAt : null,
    convertedFromId: typeof data.convertedFromId === "string" ? data.convertedFromId : null,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    updatedByName: typeof data.updatedByName === "string" ? data.updatedByName : null,
  };
}

const byNewest = (a: BusinessDocument, b: BusinessDocument) =>
  b.issuedAt.toMillis() - a.issuedAt.toMillis();

export function subscribeDocuments(
  onChange: (docs: BusinessDocument[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<BusinessDocument>(COLLECTION, (items) =>
      onChange([...items].sort(byNewest)),
    );
  }
  return onSnapshot(
    query(collection(getDb(), COLLECTION), orderBy("issuedAt", "desc")),
    (snap) => onChange(snap.docs.map(toDocument)),
    (error) => onError?.(error),
  );
}

export function subscribeDocumentsForCustomer(
  customerId: string,
  onChange: (docs: BusinessDocument[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<BusinessDocument>(COLLECTION, (items) =>
      onChange(items.filter((d) => d.customerId === customerId).sort(byNewest)),
    );
  }
  return onSnapshot(
    query(collection(getDb(), COLLECTION), where("customerId", "==", customerId)),
    (snap) => onChange(snap.docs.map(toDocument).sort(byNewest)),
    (error) => onError?.(error),
  );
}

/** Single persistence point, so demo mode swaps the write and nothing else. */
async function writeDocument(id: string, patch: Record<string, unknown>): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTION, id, patch);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, id), patch);
}

/**
 * Reads every existing number to pick the next one.
 *
 * A two-person business raises a handful of documents a week, so scanning them
 * is cheap and always correct. A stored counter would be faster and would drift
 * the first time a write failed halfway.
 */
async function allocateNumber(): Promise<string> {
  if (isDemoMode) {
    return nextNumber(demo.rows<BusinessDocument>(COLLECTION).map((d) => d.number));
  }
  const snap = await getDocs(collection(getDb(), COLLECTION));
  return nextNumber(snap.docs.map((d) => String(d.data().number ?? "")));
}

export interface NewDocumentInput {
  kind: DocumentKind;
  customer: Customer;
  serviceType: ServiceType;
  lineItems: LineItem[];
  discount?: number;
  taxRatePct?: number;
  notes?: string;
  dueAt?: Date | null;
}

export async function createDocument(
  input: NewDocumentInput,
  author: Author,
): Promise<string> {
  const taxRatePct = input.taxRatePct ?? DEFAULT_TAX_RATE_PCT;
  const discount = input.discount ?? 0;
  const totals = computeTotals(input.lineItems, discount, taxRatePct);

  const payload = {
    number: await allocateNumber(),
    kind: input.kind,
    status: "draft" satisfies DocumentStatus,
    customerId: input.customer.id,
    customerName: `${input.customer.firstName} ${input.customer.lastName}`.trim(),
    serviceType: input.serviceType,
    lineItems: input.lineItems,
    discount: totals.discount,
    taxRatePct,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    total: totals.total,
    payments: [],
    amountPaid: 0,
    balanceDue: totals.total,
    notes: input.notes ?? "",
    issuedAt: serverTimestamp(),
    dueAt: input.dueAt ? Timestamp.fromDate(input.dueAt) : null,
    sentAt: null,
    settledAt: null,
    convertedFromId: null,
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

export interface DocumentPatch {
  serviceType?: ServiceType;
  lineItems?: LineItem[];
  discount?: number;
  taxRatePct?: number;
  notes?: string;
  dueAt?: Date | null;
}

/**
 * Edits the document and recomputes the money in the same write, so the stored
 * totals can never disagree with the lines that produced them.
 */
export async function updateDocument(
  document: BusinessDocument,
  patch: DocumentPatch,
  author: Author,
): Promise<void> {
  const lineItems = patch.lineItems ?? document.lineItems;
  const discount = patch.discount ?? document.discount;
  const taxRatePct = patch.taxRatePct ?? document.taxRatePct;
  const totals = computeTotals(lineItems, discount, taxRatePct);
  const balanceDue = Math.max(0, Number((totals.total - document.amountPaid).toFixed(2)));

  const payload: Record<string, unknown> = {
    lineItems,
    discount: totals.discount,
    taxRatePct,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    total: totals.total,
    balanceDue,
    status: statusAfterPayment(document.status, totals.total, document.amountPaid),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  if (patch.serviceType !== undefined) payload.serviceType = patch.serviceType;
  if (patch.notes !== undefined) payload.notes = patch.notes;
  if (patch.dueAt !== undefined) {
    payload.dueAt = patch.dueAt ? Timestamp.fromDate(patch.dueAt) : null;
  }

  await writeDocument(document.id, payload);
}

export async function setDocumentStatus(
  document: BusinessDocument,
  status: DocumentStatus,
  author: Author,
): Promise<void> {
  const payload: Record<string, unknown> = {
    status,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  if (status === "sent" && document.sentAt === null) payload.sentAt = serverTimestamp();
  if (status === "accepted" || status === "paid" || status === "declined") {
    payload.settledAt = serverTimestamp();
  }

  await writeDocument(document.id, payload);
}

export async function recordPayment(
  document: BusinessDocument,
  amount: number,
  method: string,
  author: Author,
  /** When the money actually arrived — a check written last Tuesday is not today. */
  receivedAt: Date | null = null,
): Promise<void> {
  const payment: Payment = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `pay-${Date.now()}`,
    amount: Number(amount.toFixed(2)),
    receivedAt: receivedAt ? Timestamp.fromDate(receivedAt) : Timestamp.now(),
    method: method.trim(),
    recordedBy: author.uid,
    recordedByName: author.displayName,
  };

  const payments = [...document.payments, payment];
  const amountPaid = sumPayments(payments);
  const status = statusAfterPayment(document.status, document.total, amountPaid);

  await writeDocument(document.id, {
    payments,
    amountPaid,
    balanceDue: Math.max(0, Number((document.total - amountPaid).toFixed(2))),
    status,
    settledAt: status === "paid" ? serverTimestamp() : document.settledAt,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

export async function removePayment(
  document: BusinessDocument,
  paymentId: string,
  author: Author,
): Promise<void> {
  const payments = document.payments.filter((p) => p.id !== paymentId);
  const amountPaid = sumPayments(payments);

  await writeDocument(document.id, {
    payments,
    amountPaid,
    balanceDue: Math.max(0, Number((document.total - amountPaid).toFixed(2))),
    status: statusAfterPayment(document.status, document.total, amountPaid),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

/**
 * Turns an accepted estimate into an invoice.
 *
 * A new document rather than a flipped `kind`, so the estimate survives as the
 * record of what was agreed. If the invoice is later edited, the estimate still
 * shows the price the customer said yes to.
 */
export async function convertToInvoice(
  estimate: BusinessDocument,
  author: Author,
  dueAt: Date | null = null,
): Promise<string> {
  const payload = {
    number: await allocateNumber(),
    kind: "invoice" satisfies DocumentKind,
    status: "draft" satisfies DocumentStatus,
    customerId: estimate.customerId,
    customerName: estimate.customerName,
    serviceType: estimate.serviceType,
    lineItems: estimate.lineItems,
    discount: estimate.discount,
    taxRatePct: estimate.taxRatePct,
    subtotal: estimate.subtotal,
    taxAmount: estimate.taxAmount,
    total: estimate.total,
    payments: [],
    amountPaid: 0,
    balanceDue: estimate.total,
    notes: estimate.notes,
    issuedAt: serverTimestamp(),
    dueAt: dueAt ? Timestamp.fromDate(dueAt) : null,
    sentAt: null,
    settledAt: null,
    convertedFromId: estimate.id,
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

export async function deleteDocument(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTION, id);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTION, id));
}

/** What the customer still owes across every open invoice. */
export function outstandingFor(docs: BusinessDocument[], customerId: string): number {
  return Number(
    docs
      .filter(
        (d) =>
          d.customerId === customerId &&
          d.kind === "invoice" &&
          d.status !== "void" &&
          d.balanceDue > 0,
      )
      .reduce((sum, d) => sum + d.balanceDue, 0)
      .toFixed(2),
  );
}

/** Money actually collected, which is what lifetime value should reflect. */
export function collectedFor(docs: BusinessDocument[], customerId: string): number {
  return Number(
    docs
      .filter((d) => d.customerId === customerId && d.kind === "invoice" && d.status !== "void")
      .reduce((sum, d) => sum + d.amountPaid, 0)
      .toFixed(2),
  );
}
