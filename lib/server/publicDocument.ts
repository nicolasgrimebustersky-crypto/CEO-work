import "server-only";

import { adminDb } from "@/lib/server/admin";
import { looksLikeShareToken, normalizeShareToken } from "@/lib/shareLinks";
import { DEFAULT_TAX_RATE_PCT, type BusinessDocument, type DocumentStatus } from "@/lib/documents";
import { SERVICE_TYPES, type ServiceType } from "@/lib/types";

/**
 * Resolving a share token to the document it opens.
 *
 * Runs on the Admin SDK, which bypasses every Firestore rule — so this file,
 * and the shape check in front of it, are the whole boundary. Nothing else
 * stands between a URL and a customer's address.
 *
 * It reads on the server rather than opening `documents` to unauthenticated
 * clients, which is the alternative and a far worse trade: a rule permitting an
 * anonymous read of any document carrying a token is one query away from
 * enumerating the collection, whereas a token that resolves nowhere here is
 * simply a 404.
 *
 * Everything returned is plain JSON. A Firestore `Timestamp` is a class
 * instance and cannot cross from a server component into a client one — the
 * first version of this page did exactly that and every valid link answered
 * 500, which the tests caught and a reader of the code would not have. So the
 * times travel as milliseconds and are rebuilt on the other side.
 */

export interface SerialPayment {
  id: string;
  amount: number;
  receivedAtMs: number | null;
  method: string;
  recordedBy: string;
  recordedByName: string;
}

/**
 * A BusinessDocument with every Timestamp flattened to milliseconds.
 *
 * `acceptance` and `decline` are dropped rather than serialised. The page has
 * no use for them — the buttons already know from the status whether this was
 * answered — and sending them would push a customer's own signature back down
 * the wire on every load of a link that may sit in a forwarded text thread.
 */
export type SerialDocument = Omit<
  BusinessDocument,
  | "issuedAt"
  | "dueAt"
  | "sentAt"
  | "settledAt"
  | "createdAt"
  | "updatedAt"
  | "payments"
  | "acceptance"
  | "decline"
> & {
  issuedAtMs: number | null;
  dueAtMs: number | null;
  sentAtMs: number | null;
  settledAtMs: number | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  payments: SerialPayment[];
};

/** Only the customer fields a document actually prints. */
export interface SerialCustomer {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
}

export interface SharedDocumentData {
  document: SerialDocument;
  customer: SerialCustomer | null;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Admin and client Timestamps are different classes; both answer toMillis. */
function millis(value: unknown): number | null {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

export async function findByShareToken(
  token: string | null | undefined,
): Promise<SharedDocumentData | null> {
  const clean = normalizeShareToken(token);
  // Refused before the database is touched, so a crawler asking for
  // /v/favicon.ico costs nothing.
  if (!looksLikeShareToken(clean)) return null;

  const snap = await adminDb()
    .collection("documents")
    .where("shareToken", "==", clean)
    .limit(1)
    .get();

  const hit = snap.docs[0];
  if (!hit) return null;

  const data = hit.data() ?? {};
  const status = text(data.status) as DocumentStatus;

  // A voided document is not a quote any more. The link keeps working for
  // everything else so a customer who saved it can still read what they agreed
  // to, but a void one has to stop stating a price.
  if (status === "void") return null;

  const serviceType = SERVICE_TYPES.includes(text(data.serviceType) as ServiceType)
    ? (text(data.serviceType) as ServiceType)
    : SERVICE_TYPES[0];

  const document: SerialDocument = {
    id: hit.id,
    number: text(data.number),
    kind: data.kind === "invoice" ? "invoice" : "estimate",
    status: status || "draft",
    customerId: text(data.customerId),
    customerName: text(data.customerName),
    serviceType,
    lineItems: Array.isArray(data.lineItems)
      ? data.lineItems.map((raw) => {
          const item = (raw ?? {}) as Record<string, unknown>;
          return {
            id: text(item.id),
            name: text(item.name),
            description: text(item.description),
            quantity: num(item.quantity, 1),
            unitPrice: num(item.unitPrice),
            discountPct: num(item.discountPct),
            taxable: item.taxable !== false,
          };
        })
      : [],
    discount: num(data.discount),
    taxRatePct: num(data.taxRatePct, DEFAULT_TAX_RATE_PCT),
    subtotal: num(data.subtotal),
    taxAmount: num(data.taxAmount),
    total: num(data.total),
    amountPaid: num(data.amountPaid),
    balanceDue: num(data.balanceDue),
    notes: text(data.notes),
    convertedFromId: text(data.convertedFromId) || null,
    convertedToId: text(data.convertedToId) || null,
    scheduledJobId: text(data.scheduledJobId) || null,
    shareToken: text(data.shareToken) || null,
    createdBy: text(data.createdBy),
    createdByName: text(data.createdByName) || "Unknown",
    updatedBy: text(data.updatedBy) || null,
    updatedByName: text(data.updatedByName) || null,
    payments: Array.isArray(data.payments)
      ? data.payments.map((raw) => {
          const payment = (raw ?? {}) as Record<string, unknown>;
          return {
            id: text(payment.id),
            amount: num(payment.amount),
            receivedAtMs: millis(payment.receivedAt),
            method: text(payment.method),
            recordedBy: text(payment.recordedBy),
            recordedByName: text(payment.recordedByName),
          };
        })
      : [],
    issuedAtMs: millis(data.issuedAt),
    dueAtMs: millis(data.dueAt),
    sentAtMs: millis(data.sentAt),
    settledAtMs: millis(data.settledAt),
    createdAtMs: millis(data.createdAt),
    updatedAtMs: millis(data.updatedAt),
  };

  return { document, customer: await customerFor(document.customerId) };
}

/**
 * The customer, reduced to what appears on the page.
 *
 * Rebuilt field by field rather than passed through, deliberately. The customer
 * record carries things the document does not print — door-knock history, the
 * do-not-knock flag, internal notes — and a link a stranger can open is the
 * last place to hand over a record that grew a field nobody reviewed.
 */
async function customerFor(customerId: string): Promise<SerialCustomer | null> {
  if (!customerId) return null;
  const snap = await adminDb().collection("customers").doc(customerId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return {
    id: snap.id,
    firstName: text(data.firstName),
    lastName: text(data.lastName),
    phone: text(data.phone),
    email: text(data.email),
    address: text(data.address),
  };
}
