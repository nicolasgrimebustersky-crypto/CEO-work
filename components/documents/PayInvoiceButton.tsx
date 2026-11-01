"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { apiUrl } from "@/lib/apiBase";
import { formatMoneyExact } from "@/lib/format";
import { MAX_TIP_CENTS, TIP_PRESETS } from "@/lib/payments";

type Tip = { kind: "none" } | { kind: "percent"; percent: number } | { kind: "other"; dollars: string };

/** Avatar fills for the crew, in the brand's order. */
const AVATAR_COLORS = ["#06a143", "#00d9ff", "#f5a524", "#ff4fd8"];

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * Paying an invoice from the customer's own copy, with the option of a tip.
 *
 * The button is cyan rather than green, which looks like the wrong choice for
 * something about money until you read the rule the palette is built on: cyan
 * is what you TAP, green is what you EARN. Green here would put a dollar figure
 * and a control in the same hue on the one screen where a customer is deciding
 * whether to hand over money — the amount they owe should be the green thing,
 * and this should look like the thing to press.
 *
 * It never sees a card number. Tapping it asks our own server for a Stripe
 * Checkout URL and sends the browser there; the card is typed on Stripe's
 * domain. The payment is recorded when Stripe tells the webhook it happened,
 * not when this page navigates — a customer who closes the tab on the success
 * screen has still paid, and one who reaches it without paying has not.
 *
 * The tip is the one amount the customer picks, and the server bounds it
 * again (lib/payments.ts tipCentsFor); this screen only offers the choice.
 * No tip is the default, and saying so is one tap — a tip asked for too hard
 * is a tip resented.
 */
export function PayInvoiceButton({
  token,
  balanceDue,
  invoiceLabel,
  crew = [],
}: {
  token: string;
  balanceDue: number;
  /** "Invoice 8904", for the line the tip sits under. */
  invoiceLabel?: string;
  /** First names of whoever did the work. Empty hides the crew line. */
  crew?: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tip, setTip] = useState<Tip>({ kind: "none" });

  const balanceCents = Math.round(balanceDue * 100);
  const capCents = Math.min(balanceCents, MAX_TIP_CENTS);

  const tipCents = (() => {
    if (tip.kind === "percent") return Math.min(Math.round((balanceCents * tip.percent) / 100), capCents);
    if (tip.kind === "other") {
      const dollars = Number(tip.dollars.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(dollars) || dollars <= 0) return 0;
      return Math.min(Math.round(dollars * 100), capCents);
    }
    return 0;
  })();
  const total = (balanceCents + tipCents) / 100;

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(apiUrl(`/api/pay/${encodeURIComponent(token)}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tip:
            tip.kind === "percent"
              ? { percent: tip.percent }
              : tipCents > 0
                ? { cents: tipCents }
                : null,
        }),
      });
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;

      if (!response.ok || !data?.url) {
        setError(data?.error || "We couldn't start the payment. Please try again, or call us.");
        setBusy(false);
        return;
      }

      // Left busy on purpose: the navigation is about to happen, and a button
      // that springs back to life for the moment before it does invites a
      // second tap.
      window.location.assign(data.url);
    } catch {
      setError("We couldn't reach the payment page. Please check your connection, or call us.");
      setBusy(false);
    }
  };

  const crewNames = names(crew);

  return (
    <section className="mx-auto mt-6 max-w-3xl rounded-3xl border border-line bg-surface p-4">
      {crew.length > 0 ? (
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="flex -space-x-3">
            {crew.map((name, index) => (
              <span
                key={`${name}-${index}`}
                className="flex size-14 items-center justify-center rounded-full border-4 border-surface text-xl font-extrabold text-black"
                style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
                aria-hidden="true"
              >
                {name.slice(0, 1).toUpperCase()}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs font-bold tracking-widest text-muted uppercase">Your crew</p>
          <p className="text-lg font-bold text-ink">{crewNames}</p>
        </div>
      ) : null}

      <p className="text-xs font-bold tracking-widest text-muted uppercase">Gratuity</p>
      <h2 className="mt-0.5 text-xl font-bold text-ink">Add a tip</h2>
      <p className="mt-1 text-sm font-semibold text-muted">
        Thanks for having us out.
        {crewNames ? ` If ${crewNames} did a great job,` : " If the crew did a great job,"} you can
        leave them a tip below. Entirely optional.
      </p>

      <div className="mt-3 flex items-baseline justify-between border-y border-line py-3">
        <span className="text-base font-semibold text-ink">{invoiceLabel ?? "Balance due"}</span>
        <span className="text-base font-bold text-ink tabular-nums">{formatMoneyExact(balanceDue)}</span>
      </div>

      <p className="mt-3 text-xs font-bold tracking-widest text-muted uppercase">Tip amount</p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {TIP_PRESETS.map((percent) => {
          const active = tip.kind === "percent" && tip.percent === percent;
          return (
            <button
              key={percent}
              type="button"
              onClick={() => setTip(active ? { kind: "none" } : { kind: "percent", percent })}
              aria-pressed={active}
              className={`tap-target flex flex-col items-center justify-center rounded-2xl border px-1 py-2 ${
                active ? "border-accent bg-accent/15" : "border-line bg-surface-2"
              }`}
            >
              <span className="text-base font-extrabold text-ink">{percent}%</span>
              <span className="text-xs font-semibold text-muted tabular-nums">
                {formatMoneyExact(Math.round((balanceCents * percent) / 100) / 100)}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setTip(tip.kind === "other" ? { kind: "none" } : { kind: "other", dollars: "" })}
          aria-pressed={tip.kind === "other"}
          className={`tap-target rounded-2xl border px-1 py-2 text-base font-extrabold text-ink ${
            tip.kind === "other" ? "border-accent bg-accent/15" : "border-line bg-surface-2"
          }`}
        >
          Other
        </button>
      </div>

      {tip.kind === "other" ? (
        <label className="mt-2 flex items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3">
          <span className="text-lg font-bold text-muted">$</span>
          <input
            inputMode="decimal"
            autoFocus
            value={tip.dollars}
            onChange={(event) => setTip({ kind: "other", dollars: event.target.value })}
            placeholder="Tip amount"
            aria-label="Custom tip in dollars"
            className="tap-target w-full bg-transparent text-lg font-bold text-ink outline-none"
          />
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => setTip({ kind: "none" })}
        className={`mt-2 w-full text-center text-sm font-bold underline-offset-2 ${
          tip.kind === "none" ? "text-ink" : "text-muted underline"
        }`}
      >
        {tip.kind === "none" ? "No tip" : "No tip, thanks"}
      </button>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-base font-bold text-ink">Total</span>
        <span className="text-2xl font-extrabold text-money tabular-nums">{formatMoneyExact(total)}</span>
      </div>

      <Button
        variant="primary"
        className="mt-3 w-full"
        onClick={start}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Opening secure checkout…" : `Pay ${formatMoneyExact(total)} by card`}
      </Button>
      <p className="mt-2 text-center text-xs font-semibold text-muted">
        Card details are entered on Stripe&apos;s secure page, never here.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-center text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
