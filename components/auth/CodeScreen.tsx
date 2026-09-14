"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useAuth } from "@/components/providers/AuthProvider";
import { apiUrl } from "@/lib/apiBase";
import { getFirebaseAuth } from "@/lib/firebase";
import {
  OTP_LENGTH,
  OTP_RESEND_SECONDS,
  emptyBoxes,
  eraseDigit,
  isCompleteCode,
  maskEmail,
  placeDigits,
} from "@/lib/otp";
import { LoginBackdrop } from "./LoginBackdrop";

type Stage = "sending" | "ready" | "checking" | "verified" | "failed";

async function bearer(): Promise<string> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("You are signed out. Sign in again.");
  return user.getIdToken();
}

async function call(path: string, body: unknown): Promise<{ ok: boolean; error: string }> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer()}` },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { error?: unknown };
  return {
    ok: response.ok,
    error: typeof json.error === "string" ? json.error : response.ok ? "" : "Something went wrong.",
  };
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * The second step of signing in: six boxes for the emailed code.
 *
 * Reached only from AuthGate, only for approved crew whose sign-in has not yet
 * entered a code. What it does is small — ask the server for a code, hand one
 * back — and the server is where every decision is made. The screen never
 * learns the code, never decides whether a guess was right, and cannot mark
 * anything verified; it asks, and the token it is handed afterwards is the
 * answer.
 *
 * The code is requested once, on arrival, so the person is not made to tap a
 * button to get a thing they obviously want. A resend is offered after a
 * pause rather than instantly, because two codes in a row is the one thing
 * that makes the first one confusing.
 */
export function CodeScreen() {
  const { email, signOutNow, confirmCode } = useAuth();

  const [stage, setStage] = useState<Stage>("sending");
  const [boxes, setBoxes] = useState<string[]>(emptyBoxes);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string>("");
  const [cooldown, setCooldown] = useState(0);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const requested = useRef(false);

  const focusBox = useCallback((index: number) => {
    const el = inputs.current[index];
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const send = useCallback(async () => {
    setStage("sending");
    setError(null);
    setBoxes(emptyBoxes());
    const result = await call("/api/otp/send", {});
    if (!result.ok) {
      setStage("failed");
      setError(result.error);
      return;
    }
    setStage("ready");
    setCooldown(OTP_RESEND_SECONDS);
    setSentTo(email ? maskEmail(email) : "your email");
    setTimeout(() => focusBox(0), 0);
  }, [email, focusBox]);

  // Once. React's development double-mount would otherwise send two codes and
  // silently invalidate the first — the ref survives the remount, state does not.
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void send();
  }, [send]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const verify = useCallback(
    async (code: string) => {
      setStage("checking");
      setError(null);
      const result = await call("/api/otp/verify", { code });
      if (!result.ok) {
        setStage("ready");
        setError(result.error);
        setBoxes(emptyBoxes());
        setTimeout(() => focusBox(0), 0);
        return;
      }
      setStage("verified");
      // A beat with the six ticks showing. The app opening the instant the
      // last digit lands reads as the screen having given up, not succeeded.
      setTimeout(() => void confirmCode(), 650);
    },
    [confirmCode, focusBox],
  );

  // Typing is allowed after a failed send as well as a successful one. The
  // failure may be the resend; the code from a minute ago is still good.
  const canType = stage === "ready" || stage === "failed";

  function onInput(index: number, raw: string) {
    if (!canType) return;
    // A second character typed into a full box replaces it rather than
    // spilling both into the next: the first character is the old value.
    const typed = raw.length > 1 && boxes[index] && raw.startsWith(boxes[index]) ? raw.slice(1) : raw;
    const next = placeDigits(boxes, index, typed);
    setBoxes(next.boxes);
    setError(null);
    focusBox(next.focus);
    const code = next.boxes.join("");
    if (isCompleteCode(code)) void verify(code);
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (!canType) return;
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = eraseDigit(boxes, index);
      setBoxes(next.boxes);
      focusBox(next.focus);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  const verified = stage === "verified";
  const status =
    stage === "sending"
      ? "Sending your code…"
      : stage === "checking"
        ? "Checking…"
        : stage === "verified"
          ? "Code verified"
          : stage === "failed"
            ? "Could not send a code"
            : error
              ? error
              : `Enter the ${OTP_LENGTH}-digit code`;
  const dot =
    stage === "verified"
      ? "bg-login-accent"
      : stage === "failed" || (stage === "ready" && error)
        ? "bg-danger"
        : stage === "ready"
          ? "bg-ink/40"
          : "bg-ink/40 animate-pulse";

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <LoginBackdrop />

      <section
        aria-labelledby="code-heading"
        className="relative w-full max-w-md rounded-3xl border border-white/10 bg-black/55 p-6 text-center shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:p-9"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -left-2 -top-2 h-12 w-12 rounded-tl-[1.75rem] border-l border-t border-white/25"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-2 -right-2 h-12 w-12 rounded-br-[1.75rem] border-b border-r border-white/25"
        />

        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ink/50">
          Security check
        </p>
        <h1 id="code-heading" className="mt-2 text-2xl font-bold tracking-tight text-ink">
          Enter your code
        </h1>
        <p className="mt-1.5 text-sm text-ink/55">
          {stage === "failed"
            ? "We could not send one."
            : `We sent a ${OTP_LENGTH}-digit code to ${sentTo || (email ? maskEmail(email) : "your email")}.`}
        </p>

        <div
          className="mt-7 flex items-center justify-center gap-2 sm:gap-2.5"
          role="group"
          aria-label={`${OTP_LENGTH}-digit code`}
        >
          {boxes.map((value, index) => (
            <Fragment key={index}>
              {index === OTP_LENGTH / 2 ? (
                <span aria-hidden className="mx-0.5 h-px w-3 shrink-0 bg-white/25" />
              ) : null}
              <div className="relative">
                <input
                  ref={(el) => {
                    inputs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  // Lets iOS offer the code from the mail notification. It
                  // drops all six digits into this one box; placeDigits
                  // spreads them out.
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  aria-label={`Digit ${index + 1}`}
                  value={value}
                  disabled={!canType}
                  onChange={(e) => onInput(index, e.target.value)}
                  onKeyDown={(e) => onKeyDown(index, e)}
                  onFocus={(e) => e.target.select()}
                  className={`gb-glass-input h-14 w-11 rounded-xl border text-center text-2xl font-semibold transition focus:outline-none sm:h-16 sm:w-12 ${
                    verified
                      ? "border-login-accent/70 bg-login-accent/10 text-transparent"
                      : "border-white/10 bg-white/[0.04] text-ink focus:border-login-accent/80 focus:bg-white/[0.06] disabled:opacity-60"
                  }`}
                />
                {verified ? (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-login-accent">
                    <CheckIcon />
                  </span>
                ) : null}
              </div>
            </Fragment>
          ))}
        </div>

        <p
          role="status"
          aria-live="polite"
          className={`mt-6 flex items-center justify-center gap-2 text-sm font-medium ${
            verified ? "text-login-accent" : error || stage === "failed" ? "text-ink" : "text-ink/70"
          }`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
          {status}
        </p>
        {stage === "failed" && error ? (
          <p role="alert" className="mt-3 rounded-xl border border-danger/50 bg-danger/10 px-3.5 py-2.5 text-left text-sm text-ink">
            {error}
          </p>
        ) : null}

        <p className="mt-3 text-xs text-ink/40">Tip: paste to fill every box at once.</p>

        <div className="mt-7 flex items-center justify-center gap-5 text-sm">
          <button
            type="button"
            onClick={() => void send()}
            disabled={stage === "sending" || stage === "checking" || verified || cooldown > 0}
            className="font-semibold text-login-accent transition hover:brightness-110 disabled:text-ink/40 disabled:hover:brightness-100"
          >
            {cooldown > 0 ? `Send again in ${cooldown}s` : "Send a new code"}
          </button>
          <span aria-hidden className="h-4 w-px bg-white/15" />
          <button
            type="button"
            onClick={() => void signOutNow()}
            className="font-medium text-ink/60 transition hover:text-ink"
          >
            Not you? Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
