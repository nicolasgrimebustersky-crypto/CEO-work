"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/providers/AuthProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { UserChip } from "@/components/ui/Chips";
import { TextField } from "@/components/ui/Field";
import { updateUserProfile } from "@/lib/db/users";
import { formatPhone, formatRelative } from "@/lib/format";

/**
 * Profile plus the team roster. The roster doubles as the legend for every
 * colour in the app — the same colour is this person's map dot, their
 * attribution chips, and their calendar blocks.
 */
export function AccountScreen() {
  const { email, signOutNow } = useAuth();
  const { me, users, author, colorFor, error } = useTeam();

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    setDisplayName(me.displayName);
    setPhone(me.phone);
  }, [me]);

  async function save() {
    if (!author) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await updateUserProfile(author.uid, { displayName: displayName.trim(), phone });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="pt-safe border-b border-line bg-surface px-4 pb-4">
        <h1 className="text-2xl font-black tracking-tight text-ink">Account</h1>
        {email ? (
          <p className="mt-1 text-base font-semibold text-muted">{email}</p>
        ) : null}
      </header>

      <div className="flex flex-col gap-6 px-4 py-5">
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-3 text-base font-semibold text-ink"
          >
            Can&apos;t read the team roster: {error}. Check that your uid is in the
            Firestore rules allowlist.
          </p>
        ) : null}

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-ink">Your profile</h2>
          <TextField
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            hint="Shown on your map dot and every note you log."
            autoCapitalize="words"
          />
          <TextField
            label="Phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button full onClick={() => void save()} disabled={saving || !author}>
            {saving ? "Saving…" : saved ? "Saved" : "Save profile"}
          </Button>
          {saveError ? (
            <p
              role="alert"
              className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
            >
              {saveError}
            </p>
          ) : null}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Team</h2>
          <ul className="flex flex-col gap-2">
            {users.map((user) => (
              <li
                key={user.uid}
                className="rounded-xl border border-line bg-surface-2 p-3"
                style={{ borderLeft: `4px solid ${colorFor(user.uid)}` }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <UserChip name={user.displayName} color={colorFor(user.uid)} />
                  {user.uid === author?.uid ? (
                    <span className="text-sm font-bold text-muted">you</span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-sm font-semibold text-muted">
                  {user.phone ? formatPhone(user.phone) : "No phone set"} · location{" "}
                  {formatRelative(user.lastLocationUpdate)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <Button variant="danger" full onClick={() => void signOutNow()}>
            Sign out
          </Button>
          <p className="mt-3 pb-6 text-sm font-semibold text-muted">
            Accounts can only be created from the Firebase console. Signing out here does
            not remove anything.
          </p>
        </section>
      </div>
    </div>
  );
}
