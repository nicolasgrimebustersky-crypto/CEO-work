"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { useChat } from "@/components/providers/ChatProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { hasUnread, titleFor } from "@/lib/chat/conversation";
import { formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";
import { NewChatSheet } from "./NewChatSheet";

/**
 * The chat list.
 *
 * Crew talking to each other, not the customer SMS thread — nothing here ever
 * leaves the app or costs a message. The two are separate screens for exactly
 * that reason: the cost of confusing them is an internal remark landing in
 * front of a customer.
 */
export function ChatScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { conversations, readAt, loading, error } = useChat();
  const { author, nameFor } = useTeam();
  const [composing, setComposing] = useState(searchParams.get("new") === "1");

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Team chat" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}

        <Button
          full
          className="mb-4"
          disabled={error !== null}
          onClick={() => setComposing(true)}
        >
          Start a chat
        </Button>

        {/* Never claim there are no chats when we could not read them. An
            empty state and a failure look identical from the inside and mean
            opposite things to the person holding the phone — "nobody has
            messaged you" versus "your messages are there and you cannot see
            them". */}
        {loading ? (
          <p className="text-base font-semibold text-muted">Loading…</p>
        ) : error ? null : conversations.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <p className="text-base font-bold text-ink">No chats yet</p>
            <p className="mt-1 text-sm font-semibold text-muted">
              Message one person, or start a group. It stays inside the app — no
              texts, no cost, and nothing a customer can see.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {conversations.map((conversation) => {
              const unread =
                author != null &&
                hasUnread(
                  conversation.lastMessageAt?.toMillis() ?? null,
                  readAt[conversation.id],
                  conversation.lastMessageBy,
                  author.uid,
                );

              return (
                <li key={conversation.id}>
                  <Link
                    href={routes.chatThread(conversation.id)}
                    className={`block rounded-xl border p-3 ${
                      unread
                        ? "border-accent/60 bg-accent/10"
                        : "border-line bg-surface-2"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 truncate text-base font-bold text-ink">
                        {titleFor(
                          conversation.memberUids,
                          conversation.title,
                          author?.uid ?? "",
                          nameFor,
                        )}
                      </p>
                      <span className="shrink-0 text-sm font-semibold text-muted">
                        {formatRelative(conversation.lastMessageAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm font-semibold text-muted">
                      {conversation.lastMessageText || "No messages yet"}
                    </p>
                    {unread ? (
                      <span className="mt-1.5 inline-block rounded-full bg-accent px-2.5 py-0.5 text-xs font-extrabold text-accent-ink">
                        New
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <NewChatSheet
        open={composing}
        onClose={() => setComposing(false)}
        onCreated={(id) => {
          setComposing(false);
          router.push(routes.chatThread(id));
        }}
      />
    </div>
  );
}
