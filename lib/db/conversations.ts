import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { previewOf } from "@/lib/chat/conversation";
import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import type { Author, ChatMessage, Conversation } from "@/lib/types";

const COLLECTION = COLLECTIONS.conversations;

/**
 * Team chat storage.
 *
 * Messages live in a subcollection rather than an array on the conversation.
 * An array would cap the thread at Firestore's 1MB document limit, rewrite
 * every message on every send, and push the whole history to every device on
 * every change. A subcollection pages, and a new message costs one small write.
 *
 * The conversation document still carries a copy of the last message. That is
 * denormalised on purpose: the list screen would otherwise need a subcollection
 * query per row just to render a preview line.
 *
 * Read state is one document per person per conversation, under `reads`. It has
 * to be per-person, and it cannot live on the conversation itself — a map keyed
 * by uid there would let any member rewrite everybody else's read position.
 */

function toConversation(snap: QueryDocumentSnapshot<DocumentData>): Conversation {
  const data = snap.data();
  return {
    id: snap.id,
    title: typeof data.title === "string" ? data.title : "",
    memberUids: Array.isArray(data.memberUids)
      ? data.memberUids.filter((uid): uid is string => typeof uid === "string")
      : [],
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    lastMessageAt: data.lastMessageAt instanceof Timestamp ? data.lastMessageAt : null,
    lastMessageText: typeof data.lastMessageText === "string" ? data.lastMessageText : "",
    lastMessageBy: typeof data.lastMessageBy === "string" ? data.lastMessageBy : "",
  };
}

function toMessage(snap: QueryDocumentSnapshot<DocumentData>): ChatMessage {
  const data = snap.data();
  return {
    id: snap.id,
    text: typeof data.text === "string" ? data.text : "",
    authorUid: typeof data.authorUid === "string" ? data.authorUid : "",
    authorName: typeof data.authorName === "string" ? data.authorName : "Unknown",
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
  };
}

/**
 * Every conversation this person is in.
 *
 * Filtered by membership in the query, not after the fact. The rules refuse to
 * return a conversation you are not in, and an unfiltered listen would simply
 * fail rather than returning fewer rows.
 */
export function subscribeConversations(
  uid: string,
  onChange: (conversations: Conversation[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<Conversation>(COLLECTION, (items) =>
      onChange(items.filter((item) => item.memberUids.includes(uid))),
    );
  }
  return onSnapshot(
    query(collection(getDb(), COLLECTION), where("memberUids", "array-contains", uid)),
    (snap) => onChange(snap.docs.map(toConversation)),
    (error) => onError?.(error),
  );
}

/** The messages in one thread, oldest last. */
export function subscribeMessages(
  conversationId: string,
  onChange: (messages: ChatMessage[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<ChatMessage & { conversationId?: string }>(
      COLLECTIONS.chatMessages,
      (items) =>
        onChange(items.filter((item) => item.conversationId === conversationId)),
    );
  }
  return onSnapshot(
    query(
      collection(getDb(), COLLECTION, conversationId, "messages"),
      orderBy("createdAt", "asc"),
      // A day of chat is a few dozen lines. This is a runaway guard, not a
      // paging strategy — it caps what a long-lived thread costs to open.
      limit(500),
    ),
    (snap) => onChange(snap.docs.map(toMessage)),
    (error) => onError?.(error),
  );
}

export async function createConversation(
  input: { memberUids: string[]; title?: string },
  author: Author,
): Promise<string> {
  const payload = {
    title: (input.title ?? "").trim(),
    memberUids: input.memberUids,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    lastMessageAt: null,
    lastMessageText: "",
    lastMessageBy: "",
  };
  if (isDemoMode) return demo.add(COLLECTION, payload);
  const ref = await addDoc(collection(getDb(), COLLECTION), payload);
  return ref.id;
}

/**
 * Sends a message, and updates the conversation's preview line.
 *
 * Two writes rather than a batch, and deliberately in this order: the message
 * is the record and must land first. If the preview update fails the thread is
 * still correct and merely sorts stale, which is a far better outcome than a
 * preview promising a message that was never stored.
 */
export async function sendMessage(
  conversationId: string,
  text: string,
  author: Author,
): Promise<void> {
  const body = text.trim();
  if (!body) return;

  if (isDemoMode) {
    demo.add(COLLECTIONS.chatMessages, {
      conversationId,
      text: body,
      authorUid: author.uid,
      authorName: author.displayName,
      createdAt: Timestamp.now(),
    });
    demo.update(COLLECTION, conversationId, {
      lastMessageAt: Timestamp.now(),
      lastMessageText: previewOf(body),
      lastMessageBy: author.uid,
    });
    return;
  }

  await addDoc(collection(getDb(), COLLECTION, conversationId, "messages"), {
    text: body,
    authorUid: author.uid,
    authorName: author.displayName,
    createdAt: serverTimestamp(),
  });

  await updateDoc(doc(getDb(), COLLECTION, conversationId), {
    lastMessageAt: serverTimestamp(),
    lastMessageText: previewOf(body),
    lastMessageBy: author.uid,
  });
}

/**
 * Marks this thread read, for this person only.
 *
 * Its own document under `reads/{uid}` rather than a field on the conversation.
 * A map keyed by uid on the shared document would let any member rewrite
 * anybody else's read position, and rules cannot practically police which key
 * of a map a write touched.
 */
export async function markRead(conversationId: string, uid: string): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTIONS.chatReads, `${conversationId}__${uid}`, {
      conversationId,
      uid,
      readAt: Timestamp.now(),
    });
    return;
  }
  await setDoc(
    doc(getDb(), COLLECTION, conversationId, "reads", uid),
    { readAt: serverTimestamp() },
    { merge: true },
  );
}

/** When this person last opened each thread, keyed by conversation id. */
export function subscribeReads(
  uid: string,
  conversationIds: readonly string[],
  onChange: (readAtByConversation: Record<string, number>) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<{ conversationId: string; uid: string; readAt: Timestamp }>(
      COLLECTIONS.chatReads,
      (items) => {
        const out: Record<string, number> = {};
        for (const item of items) {
          if (item.uid === uid && item.readAt) {
            out[item.conversationId] = item.readAt.toMillis();
          }
        }
        onChange(out);
      },
    );
  }

  // One listener per conversation. A collection-group query would be one
  // listener, but it needs an index and would return other people's read
  // documents for the rules to reject — this stays inside what each member is
  // already allowed to read.
  const readAt: Record<string, number> = {};
  const stops = conversationIds.map((conversationId) =>
    onSnapshot(
      doc(getDb(), COLLECTION, conversationId, "reads", uid),
      (snap) => {
        const value = snap.data()?.readAt;
        if (value instanceof Timestamp) readAt[conversationId] = value.toMillis();
        else delete readAt[conversationId];
        onChange({ ...readAt });
      },
      () => {
        // Never opened, or not readable. Either way it stays unread, which is
        // the safe direction: a missed badge is worse than an extra one.
      },
    ),
  );
  return () => {
    for (const stop of stops) stop();
  };
}
