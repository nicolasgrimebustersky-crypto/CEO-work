import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { COLLECTIONS, getDb } from "@/lib/firebase";
import { QUOTE_STATUSES, SERVICE_TYPES } from "@/lib/types";
import type { Author, Quote, QuoteStatus, ServiceType } from "@/lib/types";

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

export function subscribeAllQuotes(
  onChange: (quotes: Quote[]) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.quotes),
    (snap) =>
      onChange(snap.docs.map(toQuote).sort((a, b) => b.sentAt.toMillis() - a.sentAt.toMillis())),
    (error) => onError?.(error),
  );
}

/**
 * A quote starts life as 'sent'. The nightly follow-up cron only chases quotes
 * that have been flipped to 'no_response', so nothing is chased automatically
 * until someone marks it as unanswered.
 */
export async function createQuote(
  input: {
    customerId: string;
    serviceType: ServiceType;
    amount: number;
  },
  author: Author,
): Promise<string> {
  const ref = await addDoc(collection(getDb(), COLLECTIONS.quotes), {
    customerId: input.customerId,
    serviceType: input.serviceType,
    amount: input.amount,
    sentAt: serverTimestamp(),
    sentBy: author.uid,
    sentByName: author.displayName,
    status: "sent" satisfies QuoteStatus,
    followUpCount: 0,
    lastFollowUpAt: null,
  });
  return ref.id;
}

export async function setQuoteStatus(
  quoteId: string,
  status: QuoteStatus,
): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTIONS.quotes, quoteId), { status });
}

export async function deleteQuote(quoteId: string): Promise<void> {
  await deleteDoc(doc(getDb(), COLLECTIONS.quotes, quoteId));
}

/** Quote-to-close rate for the reporting screen. */
export function quoteCloseRate(quotes: Quote[]): {
  accepted: number;
  decided: number;
  rate: number;
} {
  const accepted = quotes.filter((q) => q.status === "accepted").length;
  const declined = quotes.filter((q) => q.status === "declined").length;
  const decided = accepted + declined;
  return { accepted, decided, rate: decided === 0 ? 0 : accepted / decided };
}
