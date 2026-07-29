"use client";

import { FirebaseError } from "firebase/app";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/components/providers/AuthProvider";
import { isDemoMode } from "@/lib/demo/enabled";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";

function messageFor(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "That email and password don't match an account.";
      case "auth/invalid-email":
        return "That email address isn't valid.";
      case "auth/too-many-requests":
        return "Too many attempts. Wait a minute and try again.";
      case "auth/network-request-failed":
        return "No connection. Check signal and try again.";
      default:
        return error.message;
    }
  }
  return "Sign in failed. Try again.";
}

/**
 * Sign-in only, by design. There is no registration route anywhere in the app —
 * the two accounts are created by hand in the Firebase console and the
 * Firestore rules reject every other uid.
 */
export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState(isDemoMode ? "nick@grimebusters.demo" : "");
  const [password, setPassword] = useState(isDemoMode ? "demo" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8">
          <div className="mb-3 h-1.5 w-12 rounded-full bg-accent" />
          <h1 className="text-3xl font-black tracking-tight text-ink">Grime Busters</h1>
          <p className="mt-1 text-base font-semibold text-muted">
            Door-to-door CRM · Oldham County, KY
          </p>
          {isDemoMode ? (
            <p className="mt-4 rounded-xl border border-accent/40 bg-accent/15 px-3 py-2.5 text-sm font-bold text-ink">
              Demo build. Sign in with anything — it is already filled in. The data
              behind it is invented and nothing is saved.
            </p>
          ) : null}
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <TextField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" full disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-sm font-semibold text-muted">
          {isDemoMode
            ? "The real build has no sign-up either — the two accounts are created by hand in the Firebase console."
            : "Accounts are created in the Firebase console. There is no sign-up here."}
        </p>
      </div>
    </main>
  );
}
