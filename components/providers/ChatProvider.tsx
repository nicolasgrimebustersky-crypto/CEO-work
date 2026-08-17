"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { friendlyError } from "@/lib/db/errors";
import { useAuth } from "./AuthProvider";
import { byMostRecent, hasUnread } from "@/lib/chat/conversation";
import { subscribeConversations, subscribeReads } from "@/lib/db/conversations";
import type { Conversation } from "@/lib/types";

interface ChatContextValue {
  conversations: Conversation[];
  /** Milliseconds, keyed by conversation id. Absent means never opened. */
  readAt: Record<string, number>;
  /** How many threads have something new in them. */
  unreadCount: number;
  loading: boolean;
  error: string | null;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * Team chat state, subscribed once for the whole app.
 *
 * The conversation list is small — one document per thread, carrying only a
 * preview line — so keeping it live everywhere is what lets the drawer show an
 * unread badge without opening the chat screen.
 *
 * Messages are deliberately not here. A thread can be thousands of lines, and
 * holding every thread's history in a provider would grow without limit as the
 * business does; the thread screen subscribes to its own.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { author } = useAuth();
  const uid = author?.uid ?? null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [readAt, setReadAt] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeConversations(
      uid,
      (next) => {
        setConversations(next);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(friendlyError(err, "chats"));
        setLoading(false);
      },
    );
  }, [uid]);

  // Depends on the *set* of ids rather than the array, so a new message —
  // which replaces the conversation objects but not the id list — does not
  // tear down and rebuild every read listener.
  const idKey = conversations
    .map((conversation) => conversation.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!uid || !idKey) {
      setReadAt({});
      return;
    }
    return subscribeReads(uid, idKey.split(","), setReadAt);
  }, [uid, idKey]);

  const value = useMemo<ChatContextValue>(() => {
    const ordered = byMostRecent(
      conversations.map((conversation) => ({
        ...conversation,
        lastMessageAtMs: conversation.lastMessageAt?.toMillis() ?? null,
        createdAtMs: conversation.createdAt?.toMillis() ?? null,
      })),
    );

    const unreadCount = uid
      ? ordered.filter((conversation) =>
          hasUnread(
            conversation.lastMessageAtMs,
            readAt[conversation.id],
            conversation.lastMessageBy,
            uid,
          ),
        ).length
      : 0;

    return { conversations: ordered, readAt, unreadCount, loading, error };
  }, [conversations, readAt, uid, loading, error]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}
