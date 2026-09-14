"use client";

import { FirebaseError } from "firebase/app";
import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";

import { useAuth } from "@/components/providers/AuthProvider";
import { isDemoMode } from "@/lib/demo/enabled";
import { MIN_PASSWORD, registerProblem, resetProblem, signInProblem } from "@/lib/loginForm";
import { LoginBackdrop } from "./LoginBackdrop";

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
  if (error instanceof Error && error.message) return error.message;
  return registering ? "Could not create that account." : "Sign in failed. Try again.";
}

/* ------------------------------------------------------------------ icons */
/* Inline rather than a dependency: six glyphs, one screen. */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...STROKE} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...STROKE} aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...STROKE} aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...STROKE} aria-hidden>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.6" />
      {off ? <path d="m4 4 16 16" /> : null}
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...STROKE} strokeWidth={2.2} aria-hidden>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/* ------------------------------------------------------------------ field */

interface GlassFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  icon: ReactNode;
  /** A control on the right edge — the show/hide toggle. */
  trailing?: ReactNode;
}

/**
 * Icon-led input on the glass card. Not the shared TextField: that one is
 * built for the app's surfaces, and this one exists to sit on translucent
 * black over a moving backdrop, which is a different set of colours and a
 * leading icon the shared control has no slot for.
 */
function GlassField({ id, label, icon, trailing, className = "", ...rest }: GlassFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink/80">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/40">
          {icon}
        </span>
        <input
          id={id}
          {...rest}
          className={`gb-glass-input tap-target w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-11 text-base text-ink placeholder:text-ink/30 transition focus:border-login-accent/70 focus:bg-white/[0.06] focus:outline-none ${
            trailing ? "pr-12" : "pr-4"
          } ${className}`}
        />
        {trailing ? (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span>
        ) : null}
      </div>
    </div>
  );
}

function ShowPasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? "Hide password" : "Show password"}
      aria-pressed={shown}
      className="tap-target inline-flex items-center justify-center rounded-lg text-ink/45 transition hover:text-ink/80"
    >
      <EyeIcon off={shown} />
    </button>
  );
}

/* ----------------------------------------------------------------- screen */

/**
 * Sign in, or register.
 *
 * Registering is open to anybody, and grants nothing. A new account is written
 * as `pending` and lands on a screen saying somebody has to let it in; the
 * Firestore rules deny it every customer, job and invoice until a crew member
 * approves it. The form is a request for access, not a grant of it — which is
 * the only shape an open sign-up can take over a database of real people's
 * home addresses. The card says so in as many words, under the button.
 *
 * On the look: glass over drifting gold, one yellow button, the accent word
 * in the heading picked out. Two things the reference design has are left off
 * on purpose. "Remember me" — the session already persists for everybody,
 * because a re-login prompt at a stranger's front door is not acceptable, so
 * a box that could not be unticked would be a lie. And "continue with
 * Google/Apple" — no such provider is enabled, and a button that does nothing
 * is worse than no button.
 */
export function LoginScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(isDemoMode ? "nick@grimebusters.demo" : "");
  const [password, setPassword] = useState(isDemoMode ? "demo" : "");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = registering
      ? registerProblem({ name, email, password, confirm })
      : signInProblem({ email, password });
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    setNote(null);
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

  async function onForgot() {
    const problem = resetProblem(email);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await resetPassword(email);
      // Firebase answers the same whether or not the address has an account,
      // so this wording is honest either way: a link was sent if one could be.
      setNote(`If ${email.trim()} has an account, a reset link is on its way. Check spam too.`);
    } catch (err) {
      setError(messageFor(err, false));
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setRegistering((was) => !was);
    setError(null);
    setNote(null);
    setConfirm("");
  }

  const passwordToggle = (
    <ShowPasswordToggle shown={showPassword} onToggle={() => setShowPassword((s) => !s)} />
  );

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <LoginBackdrop />

      <section
        aria-labelledby="login-heading"
        className="relative w-full max-w-md rounded-3xl border border-white/10 bg-black/55 p-6 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:p-9"
      >
        {/* The bracket corners from the reference: two L-shapes just outside
            the card, catching the light. Decorative — hidden from readers. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -left-2 -top-2 h-12 w-12 rounded-tl-[1.75rem] border-l border-t border-white/25"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-2 -right-2 h-12 w-12 rounded-br-[1.75rem] border-b border-r border-white/25"
        />

        <header className="mb-6">
          <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
            <span className="h-1 w-6 rounded-full bg-login-accent" />
            Grime Busters · Crew
          </p>
          <h1 id="login-heading" className="text-3xl font-bold tracking-tight text-ink">
            {registering ? (
              <>
                Create <span className="text-login-accent">Account</span>
              </>
            ) : (
              <>
                Welcome <span className="text-login-accent">Back</span>
              </>
            )}
          </h1>
          <p className="mt-1.5 text-sm text-ink/55">
            {registering
              ? "Ask for a spot on the crew. Someone approves it before you see anything."
              : "Sign in to your customers, schedule and money."}
          </p>
          {isDemoMode ? (
            <p className="mt-4 rounded-xl border border-login-accent/40 bg-login-accent/10 px-3 py-2.5 text-sm font-medium text-ink">
              Demo build. Sign in with anything — it is already filled in. The data
              behind it is invented and nothing is saved.
            </p>
          ) : null}
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {registering ? (
            <GlassField
              id="login-name"
              label="Full Name"
              icon={<UserIcon />}
              placeholder="Alex Johnson"
              autoComplete="name"
              autoCapitalize="words"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          ) : null}

          <GlassField
            id="login-email"
            label="Email Address"
            icon={<MailIcon />}
            type="email"
            inputMode="email"
            placeholder="name@domain.com"
            autoComplete="username"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {registering ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <GlassField
                id="login-password"
                label="Password"
                icon={<LockIcon />}
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                // Tells the password manager to offer a new one rather than
                // autofilling the existing sign-in.
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                trailing={passwordToggle}
              />
              <GlassField
                id="login-confirm"
                label="Confirm Password"
                icon={<LockIcon />}
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                trailing={passwordToggle}
              />
            </div>
          ) : (
            <div>
              <GlassField
                id="login-password"
                label="Password"
                icon={<LockIcon />}
                type={showPassword ? "text" : "password"}
                placeholder="••••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                trailing={passwordToggle}
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={onForgot}
                  disabled={busy}
                  className="text-sm font-medium text-ink/60 transition hover:text-ink disabled:opacity-50"
                >
                  Forgot password?
                </button>
              </div>
            </div>
          )}

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-danger/50 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-ink"
            >
              {error}
            </p>
          ) : null}
          {note ? (
            <p
              role="status"
              className="rounded-xl border border-login-accent/40 bg-login-accent/10 px-3.5 py-2.5 text-sm font-medium text-ink"
            >
              {note}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="tap-target mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-login-accent py-3.5 text-base font-semibold text-login-accent-ink shadow-[0_14px_34px_-12px_rgba(250,204,21,0.65)] transition hover:brightness-105 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {busy
              ? registering
                ? "Creating…"
                : "Signing in…"
              : registering
                ? "Create Account"
                : "Sign In"}
            {busy ? null : <ArrowIcon />}
          </button>

          {registering ? (
            <p className="text-xs leading-relaxed text-ink/45">
              {isDemoMode
                ? "Accounts are not real in the demo. On the live app, registering puts you in a queue until one of the crew lets you in."
                : "Registering doesn't give you access on its own. One of the crew approves the account before it can see any customers."}
            </p>
          ) : null}
        </form>

        {/* Not a link: this switches the form in place, and a link would imply
            a route that does not exist. */}
        <p className="mt-6 text-center text-sm text-ink/55">
          {registering ? "Already have an account? " : "Don't have an account? "}
          <button
            type="button"
            onClick={switchMode}
            className="font-semibold text-login-accent transition hover:brightness-110"
          >
            {registering ? "Sign In" : "Sign Up"}
          </button>
        </p>
      </section>
    </main>
  );
}
