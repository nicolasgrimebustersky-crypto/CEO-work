import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import { SHARE_TOKEN_BYTES } from "@/lib/shareLinks";
import * as demo from "@/lib/demo/store";
import {
  computeTotals,
  DEFAULT_TAX_RATE_PCT,
  defaultInvoiceDueDate,
  nextNumber,
  statusAfterPayment,
  sumPayments,
  type BusinessDocument,
  type DocumentAcceptance,
  type DocumentDecline,
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
        // Absent on everything written before per-line discounts existed, and
        // a missing value has to read as "no discount" rather than NaN.
        discountPct:
          typeof item.discountPct === "number" && Number.isFinite(item.discountPct)
            ? item.discountPct
            : 0,
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

/** The customer's approval, as written by /api/quote/[token]. */
function asAcceptance(raw: unknown): DocumentAcceptance | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const signedName = typeof value.signedName === "string" ? value.signedName : "";
  if (!signedName) return null;
  return {
    signedName,
    signature: typeof value.signature === "string" ? value.signature : "",
    requestedDate: typeof value.requestedDate === "string" ? value.requestedDate : "",
    message: typeof value.message === "string" ? value.message : "",
    acceptedAt: value.acceptedAt instanceof Timestamp ? value.acceptedAt : null,
  };
}

function asDecline(raw: unknown): DocumentDecline | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  return {
    message: typeof value.message === "string" ? value.message : "",
    declinedAt: value.declinedAt instanceof Timestamp ? value.declinedAt : null,
  };
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
    convertedToId: typeof data.convertedToId === "string" ? data.convertedToId : null,
    shareToken: typeof data.shareToken === "string" && data.shareToken ? data.shareToken : null,
    acceptance: asAcceptance(data.acceptance),
    decline: asDecline(data.decline),
    scheduledJobId:
      typeof data.scheduledJobId === "string" ? data.scheduledJobId : null,
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
    convertedToId: null,
    scheduledJobId: null,
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
 *
 * Both writes go in one batch. The estimate gets stamped with the invoice it
 * produced, and that stamp is what stops the same work being billed twice — so
 * an invoice existing without it would be worse than the conversion failing
 * outright: the button would still be live, and the second tap would issue a
 * second invoice under a second number. A batch cannot half-succeed.
 *
 * Returns the new invoice's id, or the existing one if this estimate has
 * already been converted. Converting twice is almost always a mis-tap or a
 * forgotten conversion, never an intention.
 */
export async function convertToInvoice(
  estimate: BusinessDocument,
  author: Author,
  /** Omit for the standard terms; pass null explicitly for no due date. */
  dueAt: Date | null | undefined = undefined,
): Promise<string> {
  if (estimate.convertedToId) return estimate.convertedToId;

  const due = dueAt === undefined ? defaultInvoiceDueDate() : dueAt;

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
    dueAt: due ? Timestamp.fromDate(due) : null,
    sentAt: null,
    settledAt: null,
    convertedFromId: estimate.id,
    convertedToId: null,
    scheduledJobId: null,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  /**
   * Billing for the work is the clearest possible statement that the customer
   * said yes, so the estimate follows along rather than sitting at "sent"
   * forever. A declined or void estimate is left alone — converting one of
   * those is deliberate enough that overwriting the record of what happened
   * would be the wrong call.
   */
  const estimatePatch = (invoiceId: string) => ({
    convertedToId: invoiceId,
    ...(estimate.status === "draft" || estimate.status === "sent"
      ? { status: "accepted" satisfies DocumentStatus }
      : {}),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });

  if (isDemoMode) {
    const id = demo.add(COLLECTION, payload);
    demo.update(COLLECTION, estimate.id, estimatePatch(id));
    return id;
  }

  // An id is minted client-side so both halves can go in the same batch.
  const invoiceRef = doc(collection(getDb(), COLLECTION));
  const batch = writeBatch(getDb());
  batch.set(invoiceRef, payload);
  batch.update(doc(getDb(), COLLECTION, estimate.id), estimatePatch(invoiceRef.id));
  await batch.commit();

  return invoiceRef.id;
}

/**
 * The customer's link to this document, made on first ask and reused after.
 *
 * Minted in the browser from `crypto.getRandomValues`, the same source the API
 * keys use — 24 bytes, so guessing one is not a thing that happens. It is
 * stored in the clear, unlike an API key, because unlike an API key it has to
 * be readable again: the crew send the same quote twice, and a link that
 * changed each time would leave the customer holding a dead one.
 *
 * Reused rather than rotated for the same reason. A second tap on Copy link is
 * somebody sending the quote again, not somebody revoking it.
 */
export async function ensureShareToken(document: BusinessDocument): Promise<string> {
  if (document.shareToken) return document.shareToken;

  const bytes = new Uint8Array(SHARE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  // base64url, so the token survives a URL, a text message and a copy-paste
  // without being escaped into something else.
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (isDemoMode) {
    demo.update(COLLECTION, document.id, { shareToken: token });
    return token;
  }

  await updateDoc(doc(getDb(), COLLECTION, document.id), { shareToken: token });
  return token;
}

/**
 * Takes the link back.
 *
 * The page 404s the moment this lands, which is the point: a quote sent to the
 * wrong number is not fixed by an apology, it is fixed by the link going dead.
 * Anyone still holding the old URL gets the same answer as somebody who made
 * one up.
 */
export async function revokeShareToken(documentId: string): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTION, documentId, { shareToken: null });
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, documentId), { shareToken: deleteField() });
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

/**
 * Puts an accepted estimate on the calendar as a job.
 *
 * The estimate already knows the customer, the service and the price, so the
 * only thing missing is when — which is why this takes a start and an end and
 * nothing else. Retyping a price you already agreed is how the calendar and
 * the invoice end up disagreeing about what the work was worth.
 *
 * One-time and atomic, for the same reason converting to an invoice is: the
 * button is the only feedback that anything happened, so a second tap a week
 * later — having forgotten, or because the first did not look like it worked —
 * must not produce two jobs on two different days for one agreed piece of
 * work. The id is minted client-side so both halves go in one batch, and a
 * batch cannot half-succeed: a job existing without the stamp would leave the
 * button live and the guard useless.
 */
export async function scheduleAsJob(
  estimate: BusinessDocument,
  when: { start: Date; end: Date; assignedTo: string[] },
  author: Author,
): Promise<string> {
  if (estimate.scheduledJobId) return estimate.scheduledJobId;

  const jobPayload = {
    customerId: estimate.customerId,
    serviceType: estimate.serviceType,
    scheduledStart: Timestamp.fromDate(when.start),
    scheduledEnd: Timestamp.fromDate(when.end),
    status: "scheduled",
    // The agreed total, not a re-entered number.
    price: estimate.total,
    assignedTo: when.assignedTo,
    beforePhotos: [],
    afterPhotos: [],
    // What was actually quoted, so whoever turns up knows the scope without
    // opening the estimate on a phone in a driveway.
    jobNotes: [
      `From estimate ${estimate.number}.`,
      ...estimate.lineItems.map((line) =>
        line.description ? `${line.name} — ${line.description}` : line.name,
      ),
      estimate.notes,
    ]
      .filter(Boolean)
      .join("\n"),
    completedAt: null,
    completedBy: null,
    paidAt: null,
    paidBy: null,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  const estimatePatch = (jobId: string) => ({
    scheduledJobId: jobId,
    // Scheduling the work is a statement that the customer said yes, so a
    // draft or sent estimate follows along. A declined or void one is left
    // alone: scheduling one of those is deliberate enough that overwriting the
    // record of what happened would be the wrong call.
    ...(estimate.status === "draft" || estimate.status === "sent"
      ? { status: "accepted" as const }
      : {}),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });

  if (isDemoMode) {
    const id = demo.add(COLLECTIONS.jobs, jobPayload);
    demo.update(COLLECTION, estimate.id, estimatePatch(id));
    return id;
  }

  const jobRef = doc(collection(getDb(), COLLECTIONS.jobs));
  const batch = writeBatch(getDb());
  batch.set(jobRef, jobPayload);
  batch.update(doc(getDb(), COLLECTION, estimate.id), estimatePatch(jobRef.id));
  await batch.commit();

  return jobRef.id;
}
