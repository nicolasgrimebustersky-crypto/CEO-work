import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "./admin";
import { DEFAULT_ORG_ID } from "@/lib/org";

/**
 * Storing a text from a number we don't have on file.
 *
 * The inbound webhook used to end like this when nothing matched:
 *
 *     console.warn(`Inbound SMS from unknown number ${from}`);
 *     return twiml();
 *
 * A 200 back to Twilio, a line in a log, and the message gone. That is the
 * right answer to Twilio — retrying will not conjure a customer record — and
 * the wrong answer to the business, which never learns somebody wrote.
 *
 * These messages go in their own collection rather than onto a customer, for
 * the obvious reason that there is no customer to put them on, and rather than
 * creating one automatically, because a collection full of half-built customers
 * named after wrong numbers and spam is its own mess. A person decides.
 *
 * Written by the Admin SDK only. The webhook is the one thing that may create
 * these, and it is the one thing that has proved a Twilio signature.
 */

const COLLECTION = "inboundSms";

/**
 * How long an unmatched message is kept.
 *
 * These are unsolicited texts from unknown numbers, which is also a fair
 * description of spam. Keeping them forever would turn the inbox into an
 * archive nobody can face, so old handled ones are dropped by the same sweep
 * that runs everything else. Ninety days is long enough that a slow-moving lead
 * is still there next season.
 */
export const UNMATCHED_RETENTION_DAYS = 90;

export interface UnmatchedRecord {
  id: string;
  from: string;
  body: string;
  handled: boolean;
}

/**
 * Files an inbound text that matched no customer.
 *
 * Returns the new document's id so the caller can name it in the crew
 * notification, and so a test can read it back.
 */
export async function recordUnmatchedInbound(input: {
  from: string;
  body: string;
  /** Twilio's message SID, so a redelivery does not create a second row. */
  messageSid?: string;
}): Promise<string> {
  const db = adminDb();

  // Twilio retries on any non-2xx and can redeliver after a timeout it decided
  // on its own. Keying by the message SID makes a repeat a no-op instead of a
  // duplicate row, which matters most on the screen that exists to be short.
  const id = input.messageSid?.trim() || crypto.randomUUID();

  await db
    .collection(COLLECTION)
    .doc(id)
    .set(
      {
        orgId: DEFAULT_ORG_ID,
        from: input.from,
        body: input.body,
        receivedAt: Timestamp.now(),
        handled: false,
        handledBy: null,
        handledAt: null,
        customerId: null,
      },
      // Merge so a redelivery refreshes nothing that a person has since
      // changed — in particular it must not un-handle a message somebody has
      // already dealt with.
      { merge: true },
    );

  return id;
}

/**
 * Marks an unmatched message dealt with.
 *
 * `customerId` is set when the number became a customer, and left null when
 * somebody simply dismissed it as spam or a wrong number. Both are handled;
 * only one is worth following a link to.
 */
export async function markUnmatchedHandled(
  id: string,
  by: { uid: string; name: string },
  customerId: string | null = null,
): Promise<void> {
  await adminDb()
    .collection(COLLECTION)
    .doc(id)
    .update({
      handled: true,
      handledBy: by.uid,
      handledByName: by.name,
      handledAt: FieldValue.serverTimestamp(),
      customerId,
    });
}
