"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/providers/AuthProvider";
import { useLocationSharing } from "@/components/providers/LocationSharingProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { UserChip } from "@/components/ui/Chips";
import { TextField } from "@/components/ui/Field";
import { updateUserProfile } from "@/lib/db/users";
import { formatPhone, formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";
import { DeleteAccountSheet } from "./DeleteAccountSheet";
import { NotificationSettings } from "./NotificationSettings";
import { TextingStatus } from "./TextingStatus";
import { useOpenMenu } from "@/components/shell/menu";
import { MenuIcon } from "@/components/shell/navIcons";

/**
 * Profile plus the team roster. The roster doubles as the legend for every
 * colour in the app — the same colour is this person's map dot, their
 * attribution chips, and their calendar blocks.
 */
export function AccountScreen() {
  const openMenu = useOpenMenu();
  const { email, signOutNow } = useAuth();
  const { me, users, author, colorFor, error } = useTeam();
  const { sharing, setSharing, permission } = useLocationSharing();

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        <div className="flex items-center gap-2">
          {openMenu ? (
            <button
              type="button"
              onClick={openMenu}
              aria-label="Open menu"
              className="tap-target -ml-2 flex shrink-0 items-center justify-center rounded-2xl px-2 text-muted hover:bg-surface-2 hover:text-ink"
            >
              <MenuIcon />
            </button>
          ) : null}
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Account</h1>
        </div>
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

        <NotificationSettings />

        <TextingStatus />

        {/* Location controls live here, not buried in Settings. Apple expects
            background location to be visibly under the user's control, and it
            is genuinely the switch you want on a Sunday afternoon. */}
        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Location sharing</h2>
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-bold text-ink">
                  {sharing ? "Sharing your location" : "Not sharing"}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-muted">
                  {sharing
                    ? "Your dot is visible to the other crew member while you're working, including when your phone is in your pocket."
                    : "Your dot is hidden and no position is recorded. You can still use every other part of the app."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={sharing}
                aria-label="Share my location"
                onClick={() => setSharing(!sharing)}
                className={`tap-target relative flex w-16 shrink-0 items-center rounded-full p-1 transition ${
                  sharing ? "bg-accent" : "bg-surface-3"
                }`}
              >
                <span
                  className={`size-8 rounded-full bg-white transition-transform ${
                    sharing ? "translate-x-6" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {sharing && permission === "denied" ? (
              <p className="mt-3 rounded-xl border border-warn/70 bg-warn/20 px-3 py-2.5 text-sm font-semibold text-ink">
                Sharing is on, but this device has location turned off for the app.
                Open Settings → Privacy &amp; Security → Location Services to allow it.
              </p>
            ) : null}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Privacy</h2>
          <Link
            href={routes.privacy}
            className="tap-target flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 text-base font-bold text-ink"
          >
            Privacy policy
            <span aria-hidden="true" className="text-muted">
              ›
            </span>
          </Link>
        </section>

        <section className="flex flex-col gap-3">
          <Button variant="secondary" full onClick={() => void signOutNow()}>
            Sign out
          </Button>
          <p className="text-sm font-semibold text-muted">
            Accounts can only be created from the Firebase console. Signing out does
            not remove anything.
          </p>

          <div className="mt-4 border-t border-line pt-4">
            <Button variant="danger" full onClick={() => setDeleting(true)}>
              Delete my account
            </Button>
            <p className="mt-2 pb-6 text-sm font-semibold text-muted">
              Removes your sign-in and your profile. Customer records stay — they
              belong to the business, not to one account.
            </p>
          </div>
        </section>

        <DeleteAccountSheet open={deleting} onClose={() => setDeleting(false)} />
      </div>
    </div>
  );
}
