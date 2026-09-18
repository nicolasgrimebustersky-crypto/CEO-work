"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConfirmationResult, User } from "firebase/auth";
import { onAuthStateChanged, signOut } from "firebase/auth";

import { BUSINESS } from "@/components/site/site-data";
import {
  portalAuth,
  portalConfigured,
  portalGet,
  portalPost,
  sendCode,
  type PortalDocument,
  type PortalJob,
} from "@/lib/portal-client";

/**
 * The customer's own account.
 *
 * Everything the business holds about them, shown to them: estimates waiting on
 * an answer, ones they have already approved, invoices sent, what is paid and
 * what is still owed, and the work booked in. The point is that a customer
 * never has to ring up to ask where something stands.
 *
 * They sign in with a code texted to their phone. Not a name — two customers
 * are called John Smith, and names are not secret, so a name would let anybody
 * who knows one read that person's addresses and prices. The code proves the
 * handset, and the CRM decides which records that handset belongs to; nothing
 * on this page makes that decision, which is why nothing on this page can be
 * talked into making it wrongly.
 */

type Phase = "phone" | "code" | "ready";

const INPUT =
  "w-full rounded-xl border border-input bg-background/60 px-4 py-3 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-ring/30";

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

const day = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

/** US-shaped, for the SMS. The CRM normalises again server side; this is for Firebase. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * What an estimate or invoice is waiting on, in the customer's terms.
 *
 * The CRM's own status words are for the crew — "sent" tells a customer
 * nothing about whether the ball is in their court.
 */
function plainStatus(doc: PortalDocument): { label: string; tone: "action" | "done" | "open" } {
  if (doc.status === "void") return { label: "Cancelled", tone: "open" };
  if (doc.kind === "estimate") {
    if (doc.status === "accepted") return { label: "You approved this", tone: "done" };
    if (doc.status === "declined") return { label: "You passed on this", tone: "open" };
    return { label: "Waiting on your approval", tone: "action" };
  }
  if (doc.status === "paid") return { label: "Paid in full", tone: "done" };
  if (doc.status === "partial") return { label: "Part paid", tone: "action" };
  return { label: "Due", tone: "action" };
}

export function AccountPortal() {
  const configured = portalConfigured();
  // Derived, not set from an effect: portalConfigured() reads build-time
  // environment variables, so an unconfigured deployment is already "ready" —
  // there is nothing to wait for and no auth listener to attach.
  const [ready, setReady] = useState(!portalConfigured());
  const [user, setUser] = useState<User | null>(null);
  const [phase, setPhase] = useState<Phase>("phone");

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [jobs, setJobs] = useState<PortalJob[]>([]);
  const [needsClaim, setNeedsClaim] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    setNeedsClaim("");
    try {
      const [docs, work] = await Promise.all([
        portalGet<{ documents: PortalDocument[] }>("/api/portal/documents"),
        // Jobs are a bonus; an account with none is normal, and a failure here
        // must not hide the paperwork, which is what people came for.
        portalGet<{ jobs: PortalJob[] }>("/api/portal/jobs").catch(() => ({ jobs: [] })),
      ]);
      setDocuments(docs.documents ?? []);
      setJobs(work.jobs ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      // The API says this in words a customer can act on, and it is the one
      // error with a next step on this page rather than a phone call.
      if (/don't have any records/i.test(message)) setNeedsClaim(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // The load is kicked off from this callback rather than a second effect
    // keyed on `user`: onAuthStateChanged fires asynchronously, so the state it
    // sets is not a synchronous cascade, and the records are fetched exactly
    // when the session that can read them appears.
    return onAuthStateChanged(portalAuth(), (next) => {
      setUser(next);
      setPhase(next ? "ready" : "phone");
      setReady(true);
      if (next) void load();
      else {
        setDocuments([]);
        setJobs([]);
        setNeedsClaim("");
      }
    });
  }, [configured, load]);


  if (!ready) {
    return <p className="py-16 text-center text-muted-foreground">Loading…</p>;
  }

  if (!configured) {
    return (
      <div className="rounded-3xl border border-border/70 bg-card p-8 text-center">
        <h2 className="font-heading text-2xl font-bold text-foreground">Accounts aren&apos;t set up yet</h2>
        <p className="mt-3 text-muted-foreground">
          Give us a call and we&apos;ll tell you exactly where your estimate or invoice stands.
        </p>
        <a
          href={BUSINESS.phoneHref}
          className="mt-6 inline-flex h-12 items-center rounded-full bg-primary px-6 font-semibold text-primary-foreground"
        >
          Call {BUSINESS.phoneDisplay}
        </a>
      </div>
    );
  }

  // ---------------------------------------------------------------- signed out
  if (!user) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-border/70 bg-card p-8">
        <h2 className="font-heading text-2xl font-bold text-foreground">Your account</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {phase === "phone"
            ? "Enter the phone number we have for you and we'll text a code. No password to remember."
            : `We texted a code to ${phone}. Enter it below.`}
        </p>

        {phase === "phone" ? (
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const e164 = toE164(phone);
              if (!e164) {
                setError("That doesn't look like a 10-digit US number.");
                return;
              }
              void (async () => {
                setBusy(true);
                setError("");
                try {
                  setConfirmation(await sendCode(e164));
                  setPhase("code");
                } catch {
                  setError("We couldn't send that code. Check the number, or call us.");
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <label className="block">
              <span className="text-sm font-medium text-foreground">Mobile number</span>
              <input
                className={`mt-1.5 ${INPUT}`}
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="(502) 555-0100"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="h-12 w-full rounded-full bg-primary font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-60"
            >
              {busy ? "Sending…" : "Text me a code"}
            </button>
          </form>
        ) : (
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!confirmation) return;
              void (async () => {
                setBusy(true);
                setError("");
                try {
                  await confirmation.confirm(code.trim());
                } catch {
                  setError("That code didn't work. Check it, or ask for a new one.");
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <label className="block">
              <span className="text-sm font-medium text-foreground">Six-digit code</span>
              <input
                className={`mt-1.5 ${INPUT} tracking-[0.3em]`}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="h-12 w-full rounded-full bg-primary font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-60"
            >
              {busy ? "Checking…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase("phone");
                setCode("");
                setError("");
              }}
              className="w-full text-sm font-semibold text-muted-foreground underline"
            >
              Use a different number
            </button>
          </form>
        )}

        {error ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}

        {/* Firebase renders its invisible reCAPTCHA into this element. It has to
            exist in the DOM before sendCode is called, hence rendering it here
            rather than creating it on demand. */}
        <div id="recaptcha-holder" />
      </div>
    );
  }

  // ----------------------------------------------------------------- signed in
  const estimates = documents.filter((doc) => doc.kind === "estimate");
  const invoices = documents.filter((doc) => doc.kind === "invoice");
  const owed = invoices.reduce((sum, doc) => sum + (doc.balanceDue || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-3xl font-extrabold tracking-tight text-foreground">Your account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {user.phoneNumber ?? user.email}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void signOut(portalAuth())}
          className="rounded-full border border-border/70 px-5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Sign out
        </button>
      </div>

      {busy ? <p className="text-muted-foreground">Loading your records…</p> : null}

      {error ? (
        <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      {needsClaim ? <ClaimForm message={needsClaim} onLinked={() => void load()} /> : null}

      {!busy && !needsClaim && documents.length === 0 && jobs.length === 0 ? (
        <p className="rounded-2xl border border-border/70 bg-card p-6 text-muted-foreground">
          Nothing on your account yet. Once we send you an estimate it will show up here.
        </p>
      ) : null}

      {owed > 0 ? (
        <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5">
          <p className="text-sm font-semibold text-primary uppercase">Outstanding balance</p>
          <p className="mt-1 font-heading text-3xl font-extrabold text-foreground">{money(owed)}</p>
        </div>
      ) : null}

      <DocumentList title="Estimates" items={estimates} empty="No estimates yet." />
      <DocumentList title="Invoices" items={invoices} empty="No invoices yet." />

      {jobs.length > 0 ? (
        <section>
          <h3 className="font-heading text-xl font-bold text-foreground">Work booked in</h3>
          <ul className="mt-3 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-card">
            {jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-4 p-4">
                <span className="font-medium text-foreground">{job.title || job.serviceType || "Scheduled work"}</span>
                <span className="text-sm text-muted-foreground">{day(job.startMs)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function DocumentList({
  title,
  items,
  empty,
}: {
  title: string;
  items: PortalDocument[];
  empty: string;
}) {
  return (
    <section>
      <h3 className="font-heading text-xl font-bold text-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-card">
          {items.map((doc) => {
            const status = plainStatus(doc);
            return (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold text-foreground">
                    {doc.number}
                    {doc.serviceType ? <span className="text-muted-foreground"> · {doc.serviceType}</span> : null}
                  </p>
                  <p className="text-sm text-muted-foreground">{day(doc.issuedAtMs ?? doc.createdAtMs)}</p>
                </div>
                <div className="text-right">
                  <p className="font-heading text-lg font-bold text-foreground">{money(doc.total)}</p>
                  <p
                    className={`text-xs font-semibold uppercase ${
                      status.tone === "action"
                        ? "text-primary"
                        : status.tone === "done"
                          ? "text-muted-foreground"
                          : "text-muted-foreground/70"
                    }`}
                  >
                    {status.label}
                    {doc.balanceDue > 0 && doc.kind === "invoice" ? ` · ${money(doc.balanceDue)} left` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Linking an account when the number they signed in with is not one we hold.
 *
 * Asks for the document number AND the total, because numbers run in a sequence
 * and are therefore guessable — the total is the part somebody counting
 * downwards from a neighbour's estimate does not have. The server enforces
 * this; the form only collects it.
 */
function ClaimForm({ message, onLinked }: { message: string; onLinked: () => void }) {
  const [number, setNumber] = useState("");
  const [total, setTotal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <p className="text-muted-foreground">{message}</p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            setBusy(true);
            setError("");
            try {
              await portalPost("/api/portal/claim", { number, total });
              onLinked();
            } catch (err) {
              setError(err instanceof Error ? err.message : "That didn't work.");
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-foreground">Estimate or invoice number</span>
            <input
              className={`mt-1.5 ${INPUT}`}
              placeholder="#8904"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-foreground">Total on it</span>
            <input
              className={`mt-1.5 ${INPUT}`}
              inputMode="decimal"
              placeholder="$420.15"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
              required
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="h-12 w-full rounded-full bg-primary font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-60 sm:w-auto sm:px-8"
        >
          {busy ? "Checking…" : "Link my account"}
        </button>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
