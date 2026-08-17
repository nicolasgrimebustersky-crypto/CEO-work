"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useChat } from "@/components/providers/ChatProvider";
import { useNotify } from "@/components/providers/NotificationsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import {
  MAX_MESSAGE_LENGTH,
  messageProblem,
  previewOf,
  titleFor,
} from "@/lib/chat/conversation";
import { markRead, sendMessage, subscribeMessages } from "@/lib/db/conversations";
import { formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { ChatMessage } from "@/lib/types";

/**
 * One conversation.
 *
 * Messages are subscribed here rather than in the provider: a thread can be
 * thousands of lines, and holding every thread's history app-wide would grow
 * without bound as the business does.
 */
export function ThreadScreen() {
  const router = useRouter();
  const conversationId = useSearchParams().get("id") ?? "";
  const { conversations } = useChat();
  const { author, nameFor, colorFor } = useTeam();
  const notify = useNotify();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  const conversation = conversations.find((entry) => entry.id === conversationId);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeMessages(conversationId, setMessages, (err) =>
      setError(err.message),
    );
  }, [conversationId]);

  // Opening the thread is what marks it read. Re-run when the newest message
  // changes so a message arriving while you are looking at it does not leave a
  // badge behind the moment you navigate away.
  const newestMs = messages.at(-1)?.createdAt?.toMillis() ?? 0;
  useEffect(() => {
    if (!conversationId || !author) return;
    void markRead(conversationId, author.uid).catch(() => {
      // A failed read receipt costs a stale badge, not a lost message.
    });
  }, [conversationId, author, newestMs]);

  // Follow the conversation down as it grows, the way every chat app does.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!author || !conversation) return;

    const problem = messageProblem(text);
    if (problem) {
      setError(problem);
      return;
    }

    const body = text.trim();
    setBusy(true);
    setError(null);
    try {
      await sendMessage(conversationId, body, author);
      setText("");

      // Everybody else in the thread, not the whole crew — a group of three
      // must not buzz the two people who are not in it.
      void notify({
        type: "chat_message",
        body: `${author.displayName}: ${previewOf(body, 60)}`,
        conversationId,
        toUids: conversation.memberUids.filter((uid) => uid !== author.uid),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that.");
    } finally {
      setBusy(false);
    }
  }

  if (!conversationId) {
    return (
      <div className="p-6">
        <p className="text-base font-semibold text-muted">No conversation chosen.</p>
        <Button className="mt-3" onClick={() => router.push(routes.chat)}>
          Back to chats
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe shrink-0 border-b border-line bg-surface px-4 pb-3">
        <button
          type="button"
          onClick={() => router.push(routes.chat)}
          className="tap-target -ml-1 text-base font-bold text-accent"
        >
          ‹ Chats
        </button>
        <h1 className="mt-1 truncate text-xl font-extrabold tracking-tight text-ink">
          {conversation
            ? titleFor(
                conversation.memberUids,
                conversation.title,
                author?.uid ?? "",
                nameFor,
              )
            : "Chat"}
        </h1>
        {conversation && conversation.memberUids.length > 2 ? (
          <p className="mt-0.5 truncate text-sm font-semibold text-muted">
            {conversation.memberUids.map(nameFor).join(", ")}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-base font-semibold text-muted">
            Nothing here yet. Say something.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((message) => {
              const mine = message.authorUid === author?.uid;
              return (
                <li
                  key={message.id}
                  className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                >
                  {/* Only on other people's messages, and only in groups where
                      there is more than one person it could be. */}
                  {!mine ? (
                    <span
                      className="mb-0.5 text-xs font-extrabold"
                      style={{ color: colorFor(message.authorUid) }}
                    >
                      {message.authorName}
                    </span>
                  ) : null}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                      mine
                        ? "bg-accent text-accent-ink"
                        : "border border-line bg-surface-2 text-ink"
                    }`}
                  >
                    <p className="text-base font-semibold whitespace-pre-wrap break-words">
                      {message.text}
                    </p>
                  </div>
                  <span className="mt-0.5 text-xs font-semibold text-muted">
                    {formatRelative(message.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottom} />
      </div>

      {error ? (
        <p
          role="alert"
          className="mx-4 mb-2 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(event) => void send(event)}
        className="pb-safe flex shrink-0 items-end gap-2 border-t border-line bg-surface px-4 pt-3"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a newline — the convention everybody
            // already has in their fingers.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(e as unknown as FormEvent);
            }
          }}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Message"
          aria-label="Message"
          className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border border-line bg-surface-2 px-3.5 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />
        <Button type="submit" disabled={busy || !text.trim()}>
          {busy ? "…" : "Send"}
        </Button>
      </form>
    </div>
  );
}
