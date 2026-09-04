"use client";

import { Timestamp } from "firebase/firestore";

import { DocumentPaper } from "@/components/documents/DocumentPaper";
import type { BusinessDocument } from "@/lib/documents";
import type { SerialCustomer, SerialDocument } from "@/lib/server/publicDocument";

/**
 * Puts the Timestamps back.
 *
 * A server component can only hand a client component plain JSON, and a
 * Firestore `Timestamp` is a class instance with a `toDate()` the paper calls.
 * The first version of the share page passed the document straight through and
 * every valid link answered 500 — which is a thing you find by fetching the URL
 * and not by reading the code, and is why tests/api.shareLink.test.mjs asks the
 * running server rather than the component.
 *
 * The conversion lives here, on the client side of the boundary, so the server
 * module stays honest about returning data and this stays the only place that
 * knows the two shapes differ.
 */
function at(millis: number | null): Timestamp | null {
  return millis === null ? null : Timestamp.fromMillis(millis);
}

export function SharedDocument({
  document,
  customer,
}: {
  document: SerialDocument;
  customer: SerialCustomer | null;
}) {
  const {
    issuedAtMs,
    dueAtMs,
    sentAtMs,
    settledAtMs,
    createdAtMs,
    updatedAtMs,
    payments,
    ...rest
  } = document;

  const hydrated: BusinessDocument = {
    ...rest,
    // Never sent to this page — see SerialDocument. The paper does not print
    // them, and a customer's own signature has no business being pushed back
    // down a link that may be sitting in a forwarded text thread.
    acceptance: null,
    decline: null,
    // Every date the record carries, not only the two this page prints. A
    // rebuild that quietly drops the rest would be a trap for whoever renders
    // something else from it later.
    issuedAt: at(issuedAtMs) ?? Timestamp.fromMillis(0),
    dueAt: at(dueAtMs),
    sentAt: at(sentAtMs),
    settledAt: at(settledAtMs),
    createdAt: at(createdAtMs) ?? Timestamp.fromMillis(0),
    updatedAt: at(updatedAtMs),
    payments: payments.map(({ receivedAtMs, ...payment }) => ({
      ...payment,
      receivedAt: at(receivedAtMs) ?? Timestamp.fromMillis(0),
    })),
  };

  return <DocumentPaper document={hydrated} customer={customer} />;
}
