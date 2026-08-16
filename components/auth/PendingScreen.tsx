"use client";

import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/Button";

/**
 * Where a registered-but-not-approved account waits.
 *
 * This is the visible half of the access model: sign-up is open, so somebody
 * lands here who has done nothing wrong and simply is not in yet. It says who
 * to ask and what happens next, rather than the "insufficient permissions"
 * error a locked-out account would otherwise collect on every screen.
 *
 * No reload is needed. The provider keeps a live subscription on the profile,
 * so the moment somebody approves this account the app opens underneath it.
 */
export function PendingScreen() {
  const { email, signOutNow } = useAuth();

  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-3 h-1.5 w-12 rounded-full bg-warn" />
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">
          Waiting to be let in
        </h1>

        <p className="mt-3 text-base font-semibold text-muted">
          Your account is created{email ? ` (${email})` : ""}, but it can&apos;t see
          anything yet. One of the crew has to approve it from their Account screen.
        </p>

        <div className="mt-5 rounded-xl border border-line bg-surface-2 p-3">
          <p className="text-base font-bold text-ink">What to do</p>
          <p className="mt-1 text-sm font-semibold text-muted">
            Tell whoever runs the crew that you&apos;ve signed up. They&apos;ll see
            you listed under Account → Waiting for access, and it takes one tap.
          </p>
        </div>

        <p className="mt-4 text-sm font-semibold text-muted">
          You can leave this open — the app unlocks by itself the moment
          you&apos;re approved.
        </p>

        <Button variant="secondary" full className="mt-6" onClick={() => void signOutNow()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
