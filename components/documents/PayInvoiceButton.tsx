"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { apiUrl } from "@/lib/apiBase";
import { formatMoney } from "@/lib/format";

/**
 * Paying an invoice from the customer's own copy.
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
 */
export function PayInvoiceButton({
  token,
  balanceDue,
}: {
  token: string;
  balanceDue: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(apiUrl(`/api/pay/${encodeURIComponent(token)}`), {
        method: "POST",
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

  return (
    <div className="mt-6">
      <Button
        variant="primary"
        className="w-full"
        onClick={start}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Opening secure checkout…" : `Pay ${formatMoney(balanceDue)} by card`}
      </Button>
      <p className="mt-2 text-center text-xs font-semibold text-muted">
        Card details are entered on Stripe&apos;s secure page, never here.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-center text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
