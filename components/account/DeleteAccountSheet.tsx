"use client";

import { FirebaseError } from "firebase/app";
import {
  EmailAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
} from "firebase/auth";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { deleteOwnProfile } from "@/lib/db/users";
import { getFirebaseAuth } from "@/lib/firebase";

const CONFIRM_WORD = "DELETE";

/**
 * In-app account deletion.
 *
 * App Store Guideline 5.1.1(v) requires any app that supports account creation
 * to let a user delete their account from inside the app — a support email is
 * explicitly not enough. Accounts here are created in the Firebase console
 * rather than in the app, which arguably puts us outside the letter of the
 * rule, but reviewers read the spirit and this is cheap to provide.
 *
 * What it deletes is the acting user's own identity and profile. It
 * deliberately does not delete the shared customer book: that is the business's
 * record of work done for third parties, not this user's personal data, and one
 * partner should not be able to erase it on the way out. The copy says so
 * plainly so nobody is surprised.
 */
export function DeleteAccountSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { email } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setConfirmText("");
    setError(null);
  }, [open]);

  async function onDelete() {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (!user || !user.email) {
      setError("You're not signed in.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Firebase requires a recent login before deletion. Re-authenticating
      // here also stops someone deleting the account from an unlocked phone
      // they picked up off a truck seat.
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);

      // Profile document first: once the auth user is gone, the security rules
      // no longer recognise this caller and the write would be refused.
      await deleteOwnProfile(user.uid);
      await deleteUser(user);
      // deleteUser signs the user out, so AuthGate takes over from here.
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  }

  const canDelete = password.length > 0 && confirmText.trim() === CONFIRM_WORD;

  return (
    <Sheet
      open={open}
      title="Delete your account"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            full
            onClick={() => void onDelete()}
            disabled={busy || !canDelete}
          >
            {busy ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base font-semibold text-ink">
          This permanently deletes your sign-in ({email ?? "this account"}) and your
          profile — your name, phone number and last known location. You will be
          signed out and will not be able to sign back in.
        </p>

        <p className="rounded-xl border border-warn/70 bg-warn/20 px-3 py-2.5 text-base font-semibold text-ink">
          Customer records, jobs, quotes and photos are the business&apos;s records
          and are <strong>not</strong> deleted. Notes you wrote keep your name on
          them so the history still reads correctly. If you need the business data
          removed too, do that first — or ask the other account holder.
        </p>

        <TextField
          label="Confirm your password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <TextField
          label={`Type ${CONFIRM_WORD} to confirm`}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
        />

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function messageFor(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
        return "That password isn't right.";
      case "auth/too-many-requests":
        return "Too many attempts. Wait a minute and try again.";
      case "auth/network-request-failed":
        return "No connection. Try again when you have signal.";
      default:
        return error.message;
    }
  }
  return "Could not delete the account.";
}
