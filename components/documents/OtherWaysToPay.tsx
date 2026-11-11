"use client";

import { useState } from "react";

import { formatMoneyExact } from "@/lib/format";

type Way = "zelle" | "check" | "cash";

/**
 * Zelle, check or cash, under the pay buttons on an invoice the customer can
 * pay. The customer taps the one they'll use and gets exactly what to do:
 * who to send it to, what to write on it, where it goes.
 *
 * No Zelle or Venmo logos are drawn here: both marks belong to their owners
 * and their rules don't allow redrawing them, so the names say where the
 * money goes and the business's own buttons do the rest (see VenmoPayButton).
 */
export function OtherWaysToPay({
  balanceDue,
  invoiceNumber,
  payableTo,
  zelle,
  phone,
  address,
}: {
  balanceDue: number;
  invoiceNumber: string;
  payableTo: string;
  zelle: string | null;
  phone: string;
  address: string;
}) {
  const [way, setWay] = useState<Way | null>(null);
  const [copied, setCopied] = useState(false);
  const amount = formatMoneyExact(balanceDue);
  const ways: { id: Way; label: string }[] = [
    ...(zelle ? [{ id: "zelle" as const, label: "Zelle" }] : []),
    { id: "check", label: "Check" },
    { id: "cash", label: "Cash" },
  ];

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an old browser, or not allowed): the text is on screen to copy by hand.
    }
  }

  return (
    <section className="mx-auto mt-4 max-w-3xl rounded-2xl border border-line bg-surface-2 px-4 py-4">
      <h2 className="text-base font-bold text-ink">Other ways to pay</h2>
      <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="How you'll pay">
        {ways.map((w) => (
          <button
            key={w.id}
            type="button"
            role="radio"
            aria-checked={way === w.id}
            onClick={() => setWay(w.id)}
            className={`tap-target flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-base font-bold transition ${
              way === w.id ? "border-accent bg-accent/10 text-ink" : "border-line bg-surface text-ink"
            }`}
          >
            <WayIcon way={w.id} />
            {w.label}
          </button>
        ))}
      </div>

      {way === "zelle" && zelle ? (
        <div className="mt-3 text-base font-semibold text-ink">
          <p>
            In your bank&apos;s app, send <span className="tabular-nums">{amount}</span> with Zelle to:
          </p>
          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
            <span className="min-w-0 truncate font-bold">{zelle}</span>
            <button
              type="button"
              onClick={() => void copy(zelle)}
              className="tap-target shrink-0 rounded-lg px-2 text-sm font-bold text-accent"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-sm text-muted">
            It should show as {payableTo}. Put &ldquo;Invoice {invoiceNumber}&rdquo; in the memo so we know it&apos;s
            yours.
          </p>
        </div>
      ) : null}

      {way === "check" ? (
        <div className="mt-3 text-base font-semibold text-ink">
          <p>
            Make it out to <span className="font-bold">{payableTo}</span> for{" "}
            <span className="tabular-nums">{amount}</span>, and write &ldquo;Invoice {invoiceNumber}&rdquo; on the memo
            line.
          </p>
          <p className="mt-2 text-sm text-muted">
            Hand it to the crew at your next visit{address ? `, or mail it to ${address}` : ""}.
          </p>
        </div>
      ) : null}

      {way === "cash" ? (
        <div className="mt-3 text-base font-semibold text-ink">
          <p>
            Pay <span className="tabular-nums">{amount}</span> to the crew when they&apos;re out — they&apos;ll mark
            this invoice paid on the spot.
          </p>
          {phone ? <p className="mt-2 text-sm text-muted">To arrange another time, call {phone}.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/** Plain generic marks — a bank, a check, a bill — not anyone's logo. */
function WayIcon({ way }: { way: Way }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "size-6",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (way === "zelle")
    return (
      <svg {...common}>
        <path d="M3 10l9-6 9 6" />
        <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
        <path d="M3 20h18" />
      </svg>
    );
  if (way === "check")
    return (
      <svg {...common}>
        <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
        <path d="M6 14h6M15 14l1.5-1.5L18 14" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="2.5" y="6.5" width="19" height="11" rx="1.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </svg>
  );
}
