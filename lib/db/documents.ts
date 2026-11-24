import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { chunkIds } from "@/lib/bulkDelete";
import { isDemoMode } from "@/lib/demo/enabled";
import { SHARE_TOKEN_BYTES } from "@/lib/shareLinks";
import * as demo from "@/lib/demo/store";
import {
  DEFAULT_TAX_RATE_PCT,
  DOCUMENT_STATUSES,
  defaultInvoiceDueDate,
  nextNumber,
  statusAfterPayment,
  sumPayments,
  type BusinessDocument,
  type DocumentAcceptance,
  type DocumentAttachment,
  type DocumentDecline,
  type DocumentKind,
  type DocumentStatus,
  type LineItem,
  type Payment,
  type QuotePackage,
} from "@/lib/documents";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { asOrgId, DEFAULT_ORG_ID } from "@/lib/org";
import { SERVICE_TYPES } from "@/lib/types";
import type { Author, Customer, ServiceType } from "@/lib/types";
import { cleanSelection } from "@/lib/subServices";
import { choosePackage, storedTotals, tidyLines } from "@/lib/packages";

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
        // Good / Better / Best. Carried through because the editor rebuilds
        // and writes back the whole list; dropping it here would quietly move
        // every package's lines into all three.
        ...(typeof item.package === "string" && item.package ? { package: item.package } : {}),
      };
    });
}

function asPackages(value: unknown): QuotePackage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is DocumentData => typeof item === "object" && item !== null)
    .filter((item) => typeof item.id === "string" && item.id)
    .map((item) => ({
      id: item.id as string,
      name: typeof item.name === "string" ? item.name : "",
    }));
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
      // Carried through, and this is not decoration. providerRef is the ONLY
      // thing stopping a replayed Stripe webhook crediting a card payment
      // twice — lib/server/stripe.ts refuses an event whose session id is
      // already on the document. Dropping it here did not merely lose a
      // label: recordPayment and removePayment rebuild the whole payments
      // array from this read and write it back, so one crew member recording
      // a check (or deleting any payment) erased the session id from the
      // card entry beside it and re-armed the double credit.
      ...(item.provider === "stripe" || item.provider === "venmo"
        ? { provider: item.provider as "stripe" | "venmo" }
        : {}),
      ...(typeof item.providerRef === "string" && item.providerRef
        ? { providerRef: item.providerRef }
        : {}),
      // Carried through for the same reason: the array is rebuilt and written
      // back on every recorded payment, and a tip dropped here is a tip the
      // crew never sees again.
      ...(typeof item.tip === "number" && Number.isFinite(item.tip) && item.tip > 0
        ? { tip: item.tip }
        : {}),
    }))
    .sort((a, b) => b.receivedAt.toMillis() - a.receivedAt.toMillis());
}

function asAttachments(value: unknown): DocumentAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is DocumentData => typeof item === "object" && item !== null)
    .filter((item) => typeof item.path === "string" && item.path)
    .map((item, index) => ({
      id: typeof item.id === "string" ? item.id : `file-${index}`,
      name: typeof item.name === "string" && item.name ? item.name : "File",
      path: item.path as string,
      contentType: typeof item.contentType === "string" ? item.contentType : "",
      size: typeof item.size === "number" ? item.size : 0,
      uploadedBy: typeof item.uploadedBy === "string" ? item.uploadedBy : "",
      uploadedByName: typeof item.uploadedByName === "string" ? item.uploadedByName : "Unknown",
      uploadedAt: item.uploadedAt instanceof Timestamp ? item.uploadedAt : Timestamp.now(),
    }));
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
    reason: typeof value.reason === "string" ? value.reason : "",
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
    orgId: asOrgId(data.orgId),
    number: typeof data.number === "string" ? data.number : "",
    kind: data.kind === "invoice" ? "invoice" : "estimate",
    status: (typeof data.status === "string" ? data.status : "draft") as DocumentStatus,
    customerId: typeof data.customerId === "string" ? data.customerId : "",
    customerName: typeof data.customerName === "string" ? data.customerName : "",
    serviceType,
    ...cleanSelection(data, serviceType),
    lineItems: asLineItems(data.lineItems),
    packages: asPackages(data.packages),
    chosenPackageId:
      typeof data.chosenPackageId === "string" && data.chosenPackageId ? data.chosenPackageId : null,
    offeredLines: asLineItems(data.offeredLines),
    discount: typeof data.discount === "number" ? data.discount : 0,
    taxRatePct: typeof data.taxRatePct === "number" ? data.taxRatePct : DEFAULT_TAX_RATE_PCT,
    subtotal: typeof data.subtotal === "number" ? data.subtotal : 0,
    taxAmount: typeof data.taxAmount === "number" ? data.taxAmount : 0,
    taxPermit: typeof data.taxPermit === "string" && data.taxPermit ? data.taxPermit : null,
    total: typeof data.total === "number" ? data.total : 0,
    payments: asPayments(data.payments),
    attachments: asAttachments(data.attachments),
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
    firstViewedAt: data.firstViewedAt instanceof Timestamp ? data.firstViewedAt : null,
    lastViewedAt: data.lastViewedAt instanceof Timestamp ? data.lastViewedAt : null,
    viewCount: typeof data.viewCount === "number" ? data.viewCount : 0,
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
  serviceTypes: ServiceType[];
  subServices: string[];
  lineItems: LineItem[];
  discount?: number;
  taxRatePct?: number;
  /** Sales-tax permit to print, from the settings at the time. */
  taxPermit?: string | null;
  notes?: string;
  dueAt?: Date | null;
  /** Good / Better / Best on an estimate. See lib/packages.ts. */
  packages?: QuotePackage[];
}

export async function createDocument(
  input: NewDocumentInput,
  author: Author,
): Promise<string> {
  const taxRatePct = input.taxRatePct ?? DEFAULT_TAX_RATE_PCT;
  const discount = input.discount ?? 0;
  const packages = input.kind === "estimate" ? (input.packages ?? []) : [];
  const lineItems = tidyLines(input.lineItems, packages);
  // With packages, the stored price is the first package's — the "from" price.
  const totals = storedTotals(lineItems, packages, discount, taxRatePct);

  const payload = {
    number: await allocateNumber(),
    kind: input.kind,
    status: "draft" satisfies DocumentStatus,
    customerId: input.customer.id,
    customerName: `${input.customer.firstName} ${input.customer.lastName}`.trim(),
    serviceType: input.serviceType,
    serviceTypes: input.serviceTypes,
    subServices: input.subServices,
    lineItems,
    packages,
    chosenPackageId: null,
    offeredLines: [],
    discount: totals.discount,
    taxRatePct,
    taxPermit: input.taxPermit?.trim() ? input.taxPermit.trim() : null,
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
    firstViewedAt: null,
    lastViewedAt: null,
    viewCount: 0,
    orgId: DEFAULT_ORG_ID,
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
  serviceTypes?: ServiceType[];
  subServices?: string[];
  lineItems?: LineItem[];
  discount?: number;
  taxRatePct?: number;
  notes?: string;
  dueAt?: Date | null;
  packages?: QuotePackage[];
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
  // Packages only while an estimate is still open: once a package is chosen
  // the document has been rewritten to it, and an invoice never has them.
  const packages =
    document.kind === "estimate" && !document.chosenPackageId
      ? (patch.packages ?? document.packages)
      : [];
  const lineItems = tidyLines(patch.lineItems ?? document.lineItems, packages);
  const discount = patch.discount ?? document.discount;
  const taxRatePct = patch.taxRatePct ?? document.taxRatePct;
  const totals = storedTotals(lineItems, packages, discount, taxRatePct);
  const balanceDue = Math.max(0, Number((totals.total - document.amountPaid).toFixed(2)));

  const payload: Record<string, unknown> = {
    lineItems,
    packages,
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
  if (patch.serviceTypes !== undefined) payload.serviceTypes = patch.serviceTypes;
  if (patch.subServices !== undefined) payload.subServices = patch.subServices;
  if (patch.notes !== undefined) payload.notes = patch.notes;
  if (patch.dueAt !== undefined) {
    payload.dueAt = patch.dueAt ? Timestamp.fromDate(patch.dueAt) : null;
  }

  await writeDocument(document.id, payload);
}

/**
 * The crew recording which package the customer chose — when the answer came
 * by phone or in person rather than through the link. Same rewrite the link
 * does on the server: the estimate becomes the chosen package's lines and
 * price, and the full offer is kept in `offeredLines`.
 */
export async function chooseDocumentPackage(
  document: BusinessDocument,
  packageId: string,
  author: Author,
): Promise<void> {
  const chosen = choosePackage(
    document.lineItems,
    document.packages,
    packageId,
    document.discount,
    document.taxRatePct,
  );
  if (!chosen) throw new Error("That package is not on this estimate.");
  await writeDocument(document.id, {
    chosenPackageId: chosen.pkg.id,
    offeredLines: document.lineItems,
    lineItems: chosen.lineItems,
    discount: chosen.totals.discount,
    subtotal: chosen.totals.subtotal,
    taxAmount: chosen.totals.taxAmount,
    total: chosen.totals.total,
    balanceDue: Math.max(0, Number((chosen.totals.total - document.amountPaid).toFixed(2))),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
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
  // A Good / Better / Best estimate nobody has chosen from has every
  // package's lines on it. Billing it as it stands would charge for all three.
  if (estimate.packages.length > 0 && !estimate.chosenPackageId) {
    throw new Error("Pick which package the customer chose before turning this into an invoice.");
  }

  const due = dueAt === undefined ? defaultInvoiceDueDate() : dueAt;

  const payload = {
    // Which business owns the invoice. Without it every "Convert to invoice"
    // was denied outright, exactly as every "Schedule the job" was before the
    // same line was added to scheduleAsJob below: firestore.rules'
    // createsInMyOrg asks that orgId is a non-empty string matching the
    // caller's org, and a MISSING field fails `is string` before any
    // comparison happens. This write is a batch, so the denial took the
    // estimate's convertedToId patch down with it and nothing applied at all.
    orgId: DEFAULT_ORG_ID,
    number: await allocateNumber(),
    kind: "invoice" satisfies DocumentKind,
    status: "draft" satisfies DocumentStatus,
    customerId: estimate.customerId,
    customerName: estimate.customerName,
    serviceType: estimate.serviceType,
    serviceTypes: estimate.serviceTypes,
    subServices: estimate.subServices,
    lineItems: estimate.lineItems,
    discount: estimate.discount,
    taxRatePct: estimate.taxRatePct,
    taxPermit: estimate.taxPermit,
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
    firstViewedAt: null,
    lastViewedAt: null,
    viewCount: 0,
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
export async function ensureShareToken(
  document: BusinessDocument,
  author: Author,
): Promise<string> {
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

  // Stamped like every other edit. The rules require it — refreshesAuthorStamp
  // insists on updatedBy matching the caller and updatedAt appearing in the
  // diff — and the first version of this wrote the token alone, which Firestore
  // refused. From the crew's side that looked like a button that did nothing.
  await updateDoc(doc(getDb(), COLLECTION, document.id), {
    shareToken: token,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
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
export async function revokeShareToken(documentId: string, author: Author): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTION, documentId, { shareToken: null });
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, documentId), {
    shareToken: deleteField(),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

export async function deleteDocument(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTION, id);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTION, id));
}

/**
 * Delete several documents at once, from the list's select mode.
 *
 * Batched so the whole selection lands as one write per chunk rather than one
 * round trip per row — the difference between a tap and a visible stall when
 * somebody clears out a month of test invoices.
 *
 * Chunked because Firestore refuses a batch over 500 writes: without it a big
 * selection is rejected *after* the person has already confirmed it. Chunks
 * commit in order, so an interruption partway through leaves earlier chunks
 * deleted and later ones untouched — which is the honest outcome, and why the
 * caller refreshes from the live listener rather than assuming all or nothing.
 */
export async function deleteDocuments(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  if (isDemoMode) {
    for (const id of ids) demo.remove(COLLECTION, id);
    return;
  }
  const db = getDb();
  for (const chunk of chunkIds(ids)) {
    const batch = writeBatch(db);
    for (const id of chunk) batch.delete(doc(db, COLLECTION, id));
    await batch.commit();
  }
}

/**
 * Whether a job id still points at something.
 *
 * A deleted job is not a booking: the calendar does not show it and neither
 * does the estimate, so the estimate has to be free to be booked again.
 */
async function jobStillExists(jobId: string): Promise<boolean> {
  if (isDemoMode) return demo.get(COLLECTIONS.jobs, jobId) !== null;
  return (await getDoc(doc(getDb(), COLLECTIONS.jobs, jobId))).exists();
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
  // The stamp is honoured only while the job it names still exists.
  //
  // Stopping a second tap a week later from producing a second job is the
  // point of this guard and still is. What it also did was refuse forever.
  // Deleting a job off the calendar leaves the estimate pointing at nothing,
  // and DocumentScreen deliberately treats that as unscheduled — "A deleted
  // one falls back to null, which puts the button back rather than offering a
  // link to a job that is no longer on anybody's calendar". So the screen
  // offered to book the work and this function answered with the id of the job
  // that had been deleted: the sheet took a date, closed without an error, and
  // nothing appeared on the calendar. Two halves of one feature disagreeing
  // about what the stamp means, and the symptom is a button that does nothing.
  //
  // A failed read is deliberately left to throw rather than treated as "gone".
  // Falling through on a dropped connection would book the work twice, which
  // is the thing this guard exists to prevent.
  if (estimate.scheduledJobId && (await jobStillExists(estimate.scheduledJobId))) {
    return estimate.scheduledJobId;
  }

  const jobPayload = {
    // Which business owns the job. Without it every "Schedule the job" was
    // denied outright: firestore.rules' createsInMyOrg asks that orgId is a
    // non-empty string matching the caller's org, and a missing field fails
    // the `is string` test before the comparison is ever reached. createJob in
    // lib/db/jobs.ts stamps it; this path, which builds its payload by hand
    // from an estimate rather than going through that function, did not.
    orgId: DEFAULT_ORG_ID,
    customerId: estimate.customerId,
    serviceType: estimate.serviceType,
    serviceTypes: estimate.serviceTypes,
    subServices: estimate.subServices,
    // Scheduling an accepted estimate books the work itself.
    visitType: "service",
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

  // The money model, written back alongside the stamp so the patched document
  // can satisfy validDocument().
  //
  // firestore.rules evaluates validDocument() on the WHOLE resulting document,
  // not on the patch, and it requires lineItems, payments, discount,
  // taxRatePct, subtotal, total, amountPaid and balanceDue. An estimate saved
  // before one of those existed has no such field, so the patch below was
  // refused — and because the job create shares this batch, the booking died
  // with it. The sheet said "Missing or insufficient permissions." and no job
  // appeared, for those estimates only, which is what made it look
  // intermittent. Editing such an estimate was refused for the same reason, so
  // there was no way back from inside the app.
  //
  // Every value here comes off the mapped estimate, which toDocument has
  // already normalised, so for a document that has the field this writes the
  // same value straight back. The one judgement call is the totals: they are
  // recomputed from the lines, exactly as updateDocument does on every edit —
  // but only when there ARE lines to recompute from. An estimate whose
  // lineItems were lost would otherwise have the agreed total it still carries
  // rewritten to zero, and quietly restating a price a customer accepted is
  // worse than refusing to book the job.
  const totals =
    estimate.lineItems.length > 0
      ? storedTotals(estimate.lineItems, estimate.packages, estimate.discount, estimate.taxRatePct)
      : {
          discount: estimate.discount,
          subtotal: estimate.subtotal,
          taxAmount: estimate.taxAmount,
          total: estimate.total,
        };

  const estimatePatch = (jobId: string) => ({
    scheduledJobId: jobId,
    // The whole shape validDocument() checks, not only the money.
    //
    // The money alone was not enough, and the reason is worth keeping: a field
    // can be PRESENT and invalid as easily as missing. `serviceTypes: []`
    // satisfies `is list` and fails `size() >= 1`; a serviceTypes carrying a
    // service that no longer exists fails hasOnly; a status outside the enum
    // fails outright. toDocument already normalises every one of these on the
    // way in — cleanSelection guarantees at least one real main service, kind
    // falls back to 'estimate', serviceType to 'pressure_washing' — so the
    // mapped estimate in hand is always valid even when the stored document is
    // not. Writing it back is what makes the stored document valid too, and
    // leaving these five out is why the first attempt at this fix still left
    // the sheet saying "Missing or insufficient permissions."
    kind: estimate.kind,
    serviceType: estimate.serviceType,
    serviceTypes: estimate.serviceTypes,
    subServices: estimate.subServices,
    lineItems: estimate.lineItems,
    // No payments field means no payments were ever recorded, so an empty list
    // and a zero are the accurate values rather than invented ones.
    payments: estimate.payments,
    amountPaid: estimate.amountPaid,
    discount: totals.discount,
    taxRatePct: estimate.taxRatePct,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    total: totals.total,
    balanceDue: Math.max(0, Number((totals.total - estimate.amountPaid).toFixed(2))),
    // Scheduling the work is a statement that the customer said yes, so a
    // draft or sent estimate follows along. A declined or void one is left
    // alone: scheduling one of those is deliberate enough that overwriting the
    // record of what happened would be the wrong call.
    // The one field toDocument does not make safe: it casts any string
    // through, so a stored status outside the enum arrives here intact and
    // would be written straight back out again.
    //
    // Booking the work says the customer agreed, so draft and sent become
    // accepted as they always did, and anything unrecognised becomes accepted
    // too — it is the only honest reading of "this is being scheduled". A
    // declined or void estimate keeps its status: scheduling one of those is
    // deliberate enough that overwriting the record of what happened would be
    // the wrong call, which was the original reasoning here and still holds.
    status:
      estimate.status === "draft" || estimate.status === "sent"
        ? ("accepted" as const)
        : DOCUMENT_STATUSES.includes(estimate.status)
          ? estimate.status
          : ("accepted" as const),
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
