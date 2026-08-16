"use client";

import { useCallback, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { setNotificationScopes, setUserRole } from "@/lib/db/users";
import {
  CATEGORY_LABEL,
  NOTIFICATION_CATEGORIES,
  allowsCategory,
  type NotificationCategory,
} from "@/lib/notifications/events";
import { isBootstrapCrew } from "@/lib/auth/roles";
import type { AppUser } from "@/lib/types";

/**
 * Letting somebody in, and putting them back out.
 *
 * Sign-up is open, so this is the gate — and it is one person's gate. Only the
 * admin sees it; the other crew use every part of the app and hand out
 * nothing. Hiding it is the courtesy, the rules are the enforcement: a
 * non-admin who called `setUserRole` directly would be refused by Firestore.
 *
 * Approving writes one field on somebody else's profile. The rules permit
 * `role` and nothing else, so an approver cannot quietly rename an account or
 * move its map dot on the way past.
 *
 * Removing access is on the same screen on purpose. A grant you cannot see and
 * cannot reverse is how a login ends up outliving the person who left.
 */
export function PendingAccounts() {
  const { users, pendingUsers, isAdmin, author } = useTeam();
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

  // Not the admin: this whole section is not theirs to see.
  if (!isAdmin) return null;

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
                <ScopePicker user={user} />
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


/**
 * Which notification categories this person is allowed to hear about.
 *
 * A permission, not a preference — the person themselves still chooses what to
 * switch on within it, on their own Account screen. Taking a category away
 * here means they stop receiving it and stop being offered the switch.
 *
 * Absent means all of them. A profile written before this existed must not
 * silently stop hearing about the job it was just assigned, so restricting is
 * always something somebody did on purpose.
 */
function ScopePicker({ user }: { user: AppUser }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = user.notificationScopes;

  async function toggle(category: NotificationCategory) {
    // An absent scope means everything, so the first removal has to start from
    // the full list rather than from an empty one — otherwise unticking one
    // box would silently revoke the other four.
    const base: NotificationCategory[] =
      current == null
        ? [...NOTIFICATION_CATEGORIES]
        : NOTIFICATION_CATEGORIES.filter((entry) => current.includes(entry));

    const next = base.includes(category)
      ? base.filter((entry) => entry !== category)
      : [...base, category];

    setBusy(true);
    setError(null);
    try {
      await setNotificationScopes(user.uid, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-sm font-bold tracking-wide text-muted uppercase">
        Can be notified about
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {NOTIFICATION_CATEGORIES.map((category) => {
          const on = allowsCategory(current, category);
          return (
            <button
              key={category}
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={`${CATEGORY_LABEL[category]} for ${user.displayName}`}
              disabled={busy}
              onClick={() => void toggle(category)}
              className={`tap-target rounded-full border px-4 text-sm font-bold transition ${
                on
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line bg-surface text-muted"
              } ${busy ? "opacity-60" : ""}`}
            >
              {CATEGORY_LABEL[category]}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-sm font-semibold text-muted">
        They still choose which of these to switch on for themselves.
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2 text-sm font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
