import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/server/admin";

/**
 * Recording that a customer opened their own link.
 *
 * The point of the stamp is to tell two silences apart. A quote that has sat
 * unanswered for a week because nobody ever saw it wants somebody to check the
 * text arrived; the same quote, read on Tuesday and still unanswered, wants a
 * phone call about the price. Without this they look identical on the board.
 *
 * Which makes a false "Opened" worse than no feature at all: it would send
 * somebody chasing a decision the customer has not been asked to make, and it
 * would do it confidently. So what counts as a view is deliberately narrow,
 * and the narrowing lives in the caller as much as here — see the route, which
 * is driven from the browser after the page has rendered rather than from the
 * render itself.
 *
 * Why that matters more than it sounds: iMessage, WhatsApp, Messenger, Slack
 * and Outlook all fetch a URL the moment it is sent, to build the little
 * preview card. Recording a view server-side as the page renders would stamp
 * every estimate as opened within seconds of texting it — by the messaging
 * app, not by the customer — and the field would be a confident lie on every
 * record. Preview fetchers do not run JavaScript, which is the whole reason
 * the beacon is where it is.
 *
 * Admin SDK, because the share link has no signed-in caller and firestore.rules
 * gives an anonymous client nothing.
 */

/** What the stamp write did, for the route's response and for tests. */
export type ViewOutcome = "first" | "repeat" | "unknown-document";

/**
 * Stamps a view, setting the first-seen time only once.
 *
 * In a transaction because the first open is the interesting one and two
 * requests can land together — a customer who taps the link twice, or opens it
 * on a phone and a laptop in the same moment. Without it, the second write
 * would move `firstViewedAt` forward and the record would say they first
 * looked later than they did.
 *
 * `lastViewedAt` and `viewCount` move on every call by design: "opened again
 * this morning" is a different fact from "opened once a fortnight ago", and
 * the second visit is often the one that means they are deciding.
 */
export async function recordDocumentView(documentId: string): Promise<ViewOutcome> {
  const ref = adminDb().collection("documents").doc(documentId);

  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "unknown-document" as const;

    const data = snap.data() ?? {};
    const already = data.firstViewedAt instanceof Timestamp;
    const now = Timestamp.now();

    tx.update(ref, {
      // Set once. A later visit must not rewrite when they first looked.
      ...(already ? {} : { firstViewedAt: now }),
      lastViewedAt: now,
      viewCount: FieldValue.increment(1),
    });

    return already ? ("repeat" as const) : ("first" as const);
  });
}
