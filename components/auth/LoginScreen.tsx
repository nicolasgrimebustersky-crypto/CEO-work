"use client";

import { FirebaseError } from "firebase/app";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/components/providers/AuthProvider";
import { isDemoMode } from "@/lib/demo/enabled";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";

/** Firebase's own minimum. Stated up front rather than after a failed submit. */
const MIN_PASSWORD = 6;

function messageFor(error: unknown, registering: boolean): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "That email and password don't match an account.";
      case "auth/invalid-email":
        return "That email address isn't valid.";
      case "auth/email-already-in-use":
        return "There's already an account with that email. Sign in instead.";
      case "auth/weak-password":
        return `Pick a password of at least ${MIN_PASSWORD} characters.`;
      case "auth/operation-not-allowed":
        // The specific, findable cause — otherwise this reads as a bug in the
        // app rather than a switch that is off in the Firebase console.
        return "Sign-up is switched off for this project. Enable Email/Password in Firebase console → Authentication → Sign-in method.";
      case "auth/too-many-requests":
        return "Too many attempts. Wait a minute and try again.";
      case "auth/network-request-failed":
        return "No connection. Check signal and try again.";
      default:
        return error.message;
    }
  }
  return registering ? "Could not create that account." : "Sign in failed. Try again.";
}

/**
 * Sign in, or register.
 *
 * Registering is open to anybody, and grants nothing. A new account is written
 * as `pending` and lands on a screen saying somebody has to let it in; the
 * Firestore rules deny it every customer, job and invoice until a crew member
 * approves it. The form is a request for access, not a grant of it — which is
 * the only shape an open sign-up can take over a database of real people's
 * home addresses.
 */
export function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(isDemoMode ? "nick@grimebusters.demo" : "");
  const [password, setPassword] = useState(isDemoMode ? "demo" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (registering) {
        await signUp(name, email, password);
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError(messageFor(err, registering));
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setRegistering((was) => !was);
    setError(null);
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8">
          <div className="mb-3 h-1.5 w-12 rounded-full bg-accent" />
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">Grime Busters</h1>
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
          {registering ? (
            <TextField
              label="Your name"
              autoComplete="name"
              autoCapitalize="words"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              hint="What the crew will see on your notes and your map dot."
            />
          ) : null}

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
            // Tells the password manager to offer a new one rather than
            // autofilling the existing sign-in.
            autoComplete={registering ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={registering ? `At least ${MIN_PASSWORD} characters.` : undefined}
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
            {busy
              ? registering
                ? "Creating…"
                : "Signing in…"
              : registering
                ? "Request access"
                : "Sign in"}
          </Button>
        </form>

        {/* Not a link: this switches the form in place, and a link would imply
            a route that does not exist. */}
        <Button variant="ghost" full className="mt-3" onClick={switchMode}>
          {registering ? "I already have an account" : "Create an account"}
        </Button>

        <p className="mt-6 text-sm font-semibold text-muted">
          {isDemoMode
            ? "Accounts are not real in the demo. On the live app, registering puts you in a queue until one of the crew lets you in."
            : registering
              ? "Registering doesn't give you access on its own. One of the crew has to approve the account before it can see any customers."
              : "New here? Create an account and ask one of the crew to approve it."}
        </p>
      </div>
    </main>
  );
}
