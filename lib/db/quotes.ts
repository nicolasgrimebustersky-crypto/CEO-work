import {
  collection,
  onSnapshot,
  query,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { COLLECTIONS, getDb } from "@/lib/firebase";
import { QUOTE_STATUSES, SERVICE_TYPES } from "@/lib/types";
import type { Quote, QuoteStatus, ServiceType } from "@/lib/types";

export function toQuote(snap: QueryDocumentSnapshot<DocumentData>): Quote {
  const data = snap.data();
  return {
    id: snap.id,
    customerId: typeof data.customerId === "string" ? data.customerId : "",
    serviceType: SERVICE_TYPES.includes(data.serviceType as ServiceType)
      ? (data.serviceType as ServiceType)
      : "pressure_washing",
    amount: typeof data.amount === "number" ? data.amount : 0,
    sentAt: data.sentAt instanceof Timestamp ? data.sentAt : Timestamp.now(),
    sentBy: typeof data.sentBy === "string" ? data.sentBy : "",
    sentByName: typeof data.sentByName === "string" ? data.sentByName : "Unknown",
    status: QUOTE_STATUSES.includes(data.status as QuoteStatus)
      ? (data.status as QuoteStatus)
      : "sent",
    followUpCount: typeof data.followUpCount === "number" ? data.followUpCount : 0,
    lastFollowUpAt: data.lastFollowUpAt instanceof Timestamp ? data.lastFollowUpAt : null,
  };
}

export function subscribeQuotesForCustomer(
  customerId: string,
  onChange: (quotes: Quote[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const q = query(
    collection(getDb(), COLLECTIONS.quotes),
    where("customerId", "==", customerId),
  );
  return onSnapshot(
    q,
    (snap) =>
      onChange(snap.docs.map(toQuote).sort((a, b) => b.sentAt.toMillis() - a.sentAt.toMillis())),
    (error) => onError?.(error),
  );
}
