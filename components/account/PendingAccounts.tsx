"use client";

import { useCallback, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { setUserRole } from "@/lib/db/users";
import { isBootstrapCrew } from "@/lib/auth/roles";
import type { AppUser } from "@/lib/types";

/**
 * Letting somebody in, and putting them back out.
 *
 * Sign-up is open, so this is the gate. Approving writes one field on somebody
 * else's profile — the rules permit crew to change `role` and nothing else, so
 * an approver cannot quietly rename an account or move its map dot while
 * they are here.
 *
 * Removing access is on the same screen on purpose. A grant you cannot see and
 * cannot reverse is how a shared login ends up outliving the person who left.
 */
export function PendingAccounts() {
  const { users, pendingUsers, author } = useTeam();
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = useCallback(async (uid: string, role: "crew" | "pending") => {
    setBusyUid(uid);
    setError(null);
    try {
      await setUserRole(uid, role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusyUid(null);
    }
  }, []);

  const waiting = pendingUsers;
  // Everybody who is in, other than you — the list you would revoke from.
  const approved = users.filter((user) => user.uid !== author?.uid);

  return (
    <section>
      <h2 className="mb-2 text-lg font-bold text-ink">Who can get in</h2>

      <p className="mb-3 text-sm font-semibold text-muted">
        Anyone can create an account, and it sees nothing until you approve it
        here. Approving gives full access to every customer, job and invoice.
      </p>

      {waiting.length > 0 ? (
        <>
          <p className="mb-2 text-sm font-bold tracking-wide text-muted uppercase">
            Waiting for access
          </p>
          <ul className="mb-4 flex flex-col gap-2">
            {waiting.map((user) => (
              <li
                key={user.uid}
                className="rounded-xl border border-warn/60 bg-warn/10 p-3"
              >
                <Person user={user} />
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    disabled={busyUid === user.uid}
                    onClick={() => void change(user.uid, "pending")}
                  >
                    Leave out
                  </Button>
                  <Button
                    disabled={busyUid === user.uid}
                    onClick={() => void change(user.uid, "crew")}
                  >
                    {busyUid === user.uid ? "Saving…" : "Let them in"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mb-4 rounded-xl border border-line bg-surface-2 p-3 text-base font-semibold text-muted">
          Nobody is waiting.
        </p>
      )}

      {approved.length > 0 ? (
        <>
          <p className="mb-2 text-sm font-bold tracking-wide text-muted uppercase">
            Has access
          </p>
          <ul className="flex flex-col gap-2">
            {approved.map((user) => (
              <li key={user.uid} className="rounded-xl border border-line bg-surface-2 p-3">
                <Person user={user} />
                {/* The two founding accounts cannot be switched off here. The
                    rules ignore their stored role anyway, so a button that
                    appeared to work and did nothing would be a lie. */}
                {isBootstrapCrew(user.uid) ? (
                  <p className="mt-1.5 text-sm font-semibold text-muted">
                    Owner account — always has access.
                  </p>
                ) : (
                  <Button
                    variant="danger"
                    full
                    className="mt-2.5"
                    disabled={busyUid === user.uid}
                    onClick={() => void change(user.uid, "pending")}
                  >
                    {busyUid === user.uid ? "Saving…" : "Remove access"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Person({ user }: { user: AppUser }) {
  return (
    <>
      <p className="text-base font-bold text-ink">{user.displayName}</p>
      <p className="mt-0.5 text-sm font-semibold text-muted">
        {user.phone || "No phone set"}
      </p>
    </>
  );
}
