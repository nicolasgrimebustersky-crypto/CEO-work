"use client";

import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { apiUrl } from "@/lib/apiBase";
import { isDemoMode } from "@/lib/demo/enabled";
import { getDb, getFirebaseAuth } from "@/lib/firebase";
import { formatMoneyExact } from "@/lib/format";

/**
 * Venmo payments the CRM read from Venmo's emails but could not match to a
 * bill on its own (lib/server/venmo.ts), on top of the Money screen.
 *
 * Each one shows who paid, how much, their note, why it did not match, and
 * the likely bills as buttons: one tap marks that bill paid. "Not a bill"
 * dismisses it (a friend paying back dinner). Payments that matched
 * automatically are not listed here; they are already on the bill.
 *
 * Shows nothing at all when there is nothing to match.
 */

interface Suggestion {
  kind: "invoice" | "job";
  id: string;
  customerName: string;
  owed: number;
  number: string | null;
}

interface PendingPayment {
  id: string;
  payerName: string;
  amount: number;
  note: string;
  status: string;
  verified: boolean;
  matchReason: string;
  suggestions: Suggestion[];
  receivedAt: Timestamp | null;
}

async function callMatch(payload: Record<string, unknown>): Promise<void> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Not signed in.");
  const response = await fetch(apiUrl("/api/venmo/match"), {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
}

export function VenmoInbox() {
  const [pending, setPending] = useState<PendingPayment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDemoMode) return;
    const q = query(collection(getDb(), "venmoPayments"), orderBy("createdAt", "desc"), limit(40));
    return onSnapshot(
      q,
      (snap) =>
        setPending(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<PendingPayment, "id">) }))
            .filter((p) => p.status === "needs_match" || p.status === "unverified"),
        ),
      () => setPending([]),
    );
  }, []);

  if (pending.length === 0) return null;

  async function act(payment: PendingPayment, payload: Record<string, unknown>) {
    setBusy(payment.id);
    setError(null);
    try {
      await callMatch({ paymentId: payment.id, ...payload });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Venmo payments to match" className="mx-4 mt-3 rounded-2xl border border-accent/50 bg-accent/10 p-3">
      <p className="text-base font-extrabold text-ink">
        Venmo payments to match <span className="text-muted">· {pending.length}</span>
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <ul className="mt-2 flex flex-col gap-3">
        {pending.map((payment) => (
          <li key={payment.id} className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="flex items-baseline justify-between gap-2">
              <span className="text-base font-bold text-ink">{payment.payerName}</span>
              <span className="text-lg font-extrabold text-money tabular-nums">
                {formatMoneyExact(payment.amount)}
              </span>
            </p>
            {payment.note ? <p className="text-sm font-semibold text-ink/80">&ldquo;{payment.note}&rdquo;</p> : null}
            <p className="mt-0.5 text-xs font-semibold text-muted">
              {payment.receivedAt ? payment.receivedAt.toDate().toLocaleString() : ""} · {payment.matchReason}
            </p>
            {!payment.verified ? (
              <p className="mt-1 rounded-lg bg-danger/15 px-2 py-1 text-xs font-bold text-ink">
                This email failed Venmo&apos;s signature check. Check your Venmo app that this payment is real
                before matching it.
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {payment.suggestions.map((s) => (
                <Button
                  key={`${s.kind}-${s.id}`}
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(payment, {
                      kind: s.kind,
                      billId: s.id,
                      confirmUnverified: !payment.verified,
                    })
                  }
                >
                  {s.customerName || "Unknown"} · {s.kind === "invoice" ? `#${s.number}` : "job"} ·{" "}
                  {formatMoneyExact(s.owed)}
                </Button>
              ))}
              <Button variant="ghost" disabled={busy !== null} onClick={() => void act(payment, { ignore: true })}>
                Not a bill
              </Button>
            </div>
            {payment.suggestions.length === 0 ? (
              <p className="mt-1 text-xs font-semibold text-muted">
                No likely bill. Record it on the right invoice or job by hand, then tap &ldquo;Not a bill&rdquo;
                to clear it.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
