import {
  collection,
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

import { isDemoMode } from "@/lib/demo/enabled";
import { getDb } from "@/lib/firebase";
import { DEFAULT_ORG_ID } from "@/lib/org";
import type { UnmatchedMessage } from "@/lib/inboundSms";
import type { Author } from "@/lib/types";

/**
 * Reading back the texts that used to be thrown away.
 *
 * Written only by the inbound webhook through the Admin SDK — see
 * lib/server/inboundSms.ts — so there is no create or delete here. The crew's
 * one power over these is marking one handled, which is what happens when it
 * becomes a customer or is judged to be spam.
 */

const COLLECTION = "inboundSms";

export interface StoredUnmatched extends UnmatchedMessage {
  receivedAt: Timestamp;
  customerId: string | null;
}

function toUnmatched(snap: QueryDocumentSnapshot<DocumentData>): StoredUnmatched {
  const data = snap.data();
  return {
    id: snap.id,
    from: typeof data.from === "string" ? data.from : "",
    body: typeof data.body === "string" ? data.body : "",
    receivedAt: data.receivedAt instanceof Timestamp ? data.receivedAt : Timestamp.now(),
    // Anything that is not plainly `false` counts as handled, so a malformed
    // row errs towards staying out of the list rather than sitting at the top
    // of it forever with no way to clear it.
    handled: data.handled !== false,
    customerId: typeof data.customerId === "string" ? data.customerId : null,
  };
}

/**
 * Live unhandled messages.
 *
 * Filtered server-side on `handled` so a year of dealt-with spam never reaches
 * the phone. The demo store has no equivalent — demo mode fabricates customers,
 * and an unknown number is by definition one it did not fabricate — so it
 * yields an empty list rather than pretending.
 *
 * Deliberately unordered. Two equality filters are served by merging the
 * automatic single-field indexes; adding `orderBy("receivedAt")` on top of them
 * demands a composite index, and the first version of this shipped with one —
 * so the screen loaded with "The query requires an index" where the messages
 * should have been. The ordering was never needed from Firestore in the first
 * place: `groupUnmatched` sorts threads newest-first and messages oldest-first
 * in memory, because it has to group by number before it can sort by time.
 * Sorting twice bought nothing and cost the whole feature.
 *
 * Unbounded on purpose. The set is "unknown numbers nobody has dealt with yet",
 * which is small by construction and gets smaller every time somebody taps a
 * button. If it ever is not, that is a spam problem to see rather than to
 * paginate away.
 */
export function subscribeUnmatched(
  onChange: (messages: StoredUnmatched[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    onChange([]);
    return () => {};
  }

  const q = query(
    collection(getDb(), COLLECTION),
    where("orgId", "==", DEFAULT_ORG_ID),
    where("handled", "==", false),
  );

  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map(toUnmatched)),
    (error) => onError?.(error),
  );
}

/**
 * Marks one dealt with.
 *
 * `customerId` is the record it became, or null when it was dismissed. The
 * rules allow these five fields and nothing else — in particular the message
 * body cannot be edited, because it is a record of what somebody sent us.
 */
export async function markHandled(
  id: string,
  author: Author,
  customerId: string | null = null,
): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTION, id), {
    handled: true,
    handledBy: author.uid,
    handledByName: author.displayName,
    handledAt: serverTimestamp(),
    customerId,
  });
}
