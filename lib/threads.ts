/**
 * Text message threads, assembled from what the app already stores.
 *
 * Every SMS in and out is already written to the customer's notes timeline by
 * the API routes — that is what makes the timeline a complete contact record.
 * The problem is that it is the *only* place they exist: to find out whether
 * anybody has texted you back, you had to already know which customer to open.
 *
 * So this reads threads back out of the notes rather than storing them twice.
 * No new collection, no second listener, no security rules to widen, and no way
 * for a message to appear in one place and not the other — there is only one
 * copy. The customers are already loaded at the root of the app, so the whole
 * inbox costs nothing beyond the arithmetic below.
 *
 * Deliberately free of imports so it can be unit tested by running it.
 */

/** Just enough of a Timestamp to sort and render. Firestore's satisfies this. */
interface TimeLike {
  toMillis(): number;
}

interface NoteLike {
  id: string;
  text: string;
  kind: string;
  authorName: string;
  createdAt: TimeLike;
}

interface CustomerLike {
  id: string;
  notes: NoteLike[];
}

export interface ThreadMessage {
  id: string;
  text: string;
  /** "in" is from the customer, "out" is from the business. */
  direction: "in" | "out";
  /** Who sent it — a crew member's name, or the customer's. */
  authorName: string;
  at: TimeLike;
}

export interface Thread {
  customerId: string;
  /** Oldest first, the way a conversation reads. */
  messages: ThreadMessage[];
  /** The most recent message. Threads with none are never built. */
  last: ThreadMessage;
  /**
   * The customer said something and nobody has answered.
   *
   * Derived from the messages rather than stored as a flag. A flag would need
   * writing, syncing between two phones, and clearing correctly — and would be
   * wrong the moment one of those failed. This cannot drift: if the last
   * message came from them, they are waiting.
   */
  needsReply: boolean;
}

function toMessage(note: NoteLike): ThreadMessage | null {
  if (note.kind !== "sms_in" && note.kind !== "sms_out") return null;
  return {
    id: note.id,
    text: note.text,
    direction: note.kind === "sms_in" ? "in" : "out",
    authorName: note.authorName,
    at: note.createdAt,
  };
}

/**
 * One thread per customer who has ever exchanged a text, most recently active
 * first — which on a working day means whoever just replied is at the top.
 */
export function buildThreads(customers: readonly CustomerLike[]): Thread[] {
  const threads: Thread[] = [];

  for (const customer of customers) {
    const messages = customer.notes
      .map(toMessage)
      .filter((message): message is ThreadMessage => message !== null)
      .sort((a, b) => a.at.toMillis() - b.at.toMillis());

    if (messages.length === 0) continue;

    const last = messages[messages.length - 1];
    threads.push({
      customerId: customer.id,
      messages,
      last,
      needsReply: last.direction === "in",
    });
  }

  return threads.sort((a, b) => b.last.at.toMillis() - a.last.at.toMillis());
}

/** What the badge counts. */
export function needsReplyCount(threads: readonly Thread[]): number {
  return threads.filter((thread) => thread.needsReply).length;
}

/**
 * A one-line preview for the inbox row.
 *
 * Prefixed with "You: " on an outbound message, the way every messaging app
 * does it, because otherwise a list of last-messages gives no clue who spoke
 * last — which is the single most useful thing to know at a glance.
 */
export function previewOf(thread: Thread, limit = 80): string {
  const body = thread.last.text.replace(/\s+/g, " ").trim();
  const clipped = body.length > limit ? `${body.slice(0, limit - 1).trimEnd()}…` : body;
  return thread.last.direction === "out" ? `You: ${clipped}` : clipped;
}
