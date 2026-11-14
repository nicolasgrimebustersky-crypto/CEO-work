import "server-only";

import { Timestamp } from "firebase-admin/firestore";

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
 * Files an old unmatched message, unless it is already on the screen.
 *
 * Unlike recordUnmatchedInbound this never touches an existing row: running
 * the import twice must not bring back a message somebody already dismissed.
 * Returns whether it was new.
 */
export async function importUnmatchedInbound(input: {
  from: string;
  body: string;
  messageSid: string;
  receivedAt: Date;
}): Promise<boolean> {
  try {
    await adminDb()
      .collection(COLLECTION)
      .doc(input.messageSid)
      .create({
        orgId: DEFAULT_ORG_ID,
        from: input.from,
        body: input.body,
        receivedAt: Timestamp.fromDate(input.receivedAt),
        handled: false,
        handledBy: null,
        handledAt: null,
        customerId: null,
      });
    return true;
  } catch (error) {
    // 6 = ALREADY_EXISTS: filed by the webhook or an earlier import.
    if ((error as { code?: unknown })?.code === 6) return false;
    throw error;
  }
}
