"use client";

import { useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { conversationProblem, isDirect, membersFor } from "@/lib/chat/conversation";
import { createConversation } from "@/lib/db/conversations";

/**
 * Starting a chat.
 *
 * One picker for both kinds. Pick one person and it is a direct message; pick
 * more and it becomes a group and asks for a name. A separate "new group"
 * button would be a mode to choose before you know which you want — you find
 * out by picking people.
 *
 * Only crew appear. A pending account cannot read the conversation anyway, so
 * offering it would create a thread whose recipient can never open it.
 */
export function NewChatSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const { users, author } = useTeam();
  const [chosen, setChosen] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = users.filter((user) => user.uid !== author?.uid);
  const memberUids = author ? membersFor(author.uid, chosen) : [];
  const problem = conversationProblem(memberUids);
  const group = memberUids.length > 2;

  async function start() {
    if (!author || problem) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createConversation(
        { memberUids, title: group ? title : "" },
        author,
      );
      setChosen([]);
      setTitle("");
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start that chat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      title="Start a chat"
      onClose={onClose}
      footer={
        <Button full onClick={() => void start()} disabled={busy || problem !== null}>
          {busy ? "Starting…" : group ? "Start group" : "Start chat"}
        </Button>
      }
    >
      <p className="mb-1.5 text-base font-semibold text-ink">Who with?</p>
      {others.length === 0 ? (
        <p className="text-sm font-semibold text-muted">
          Nobody else has been approved yet. Approve someone on the Account
          screen and they&apos;ll show up here.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {others.map((user) => (
            <Chip
              key={user.uid}
              active={chosen.includes(user.uid)}
              onClick={() =>
                setChosen(
                  chosen.includes(user.uid)
                    ? chosen.filter((uid) => uid !== user.uid)
                    : [...chosen, user.uid],
                )
              }
            >
              {user.displayName}
            </Chip>
          ))}
        </div>
      )}

      {/* Only once it is actually a group. Asking a two-person chat for a name
          would be a field you have to skip every single time. */}
      {group ? (
        <label className="mt-4 block">
          <span className="mb-1 block text-base font-semibold text-ink">
            Name this group
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Saturday crew"
            className="tap-target w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <span className="mt-1 block text-sm font-semibold text-muted">
            Optional — without one it lists who is in it.
          </span>
        </label>
      ) : null}

      <p className="mt-3 text-sm font-semibold text-muted">
        {problem ??
          (isDirect(memberUids)
            ? "A one-to-one chat. Only the two of you can read it."
            : `A group of ${memberUids.length}. Only these people can read it.`)}
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
