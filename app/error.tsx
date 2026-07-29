"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/Button";

/**
 * Catches a render error anywhere in the app.
 *
 * Without this, one thrown exception replaces the entire page with Next's
 * "a client-side exception has occurred" — no navigation, no way back, and no
 * indication of what broke. That is a bad outcome on a laptop and a useless
 * one on a phone at a stranger's front door, where the fix cannot be "open the
 * browser console".
 *
 * The message is shown rather than hidden behind a generic apology. Two people
 * run this app and both of them are the operators; a real error string is the
 * difference between "it's broken" and a fix.
 */
export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-3 h-1.5 w-12 rounded-full bg-danger" />
        <h1 className="text-2xl font-black tracking-tight text-ink">Something broke</h1>
        <p className="mt-2 text-base font-semibold text-muted">
          Your data is safe — this is a display problem, not a lost record.
        </p>

        <pre className="mt-4 max-h-48 overflow-auto rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm font-semibold whitespace-pre-wrap text-ink">
          {error.message || "No error message was provided."}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>

        <div className="mt-5 flex flex-col gap-3">
          <Button full onClick={reset}>
            Try again
          </Button>
          <Button variant="secondary" full onClick={() => window.location.assign("/customers")}>
            Go to customers
          </Button>
        </div>

        <p className="mt-6 text-sm font-semibold text-muted">
          The customer list, pipeline and schedule do not need the map, so they
          usually still work when this happens.
        </p>
      </div>
    </main>
  );
}
