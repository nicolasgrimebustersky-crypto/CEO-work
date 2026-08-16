"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import {
  checkTexting,
  sendTestText,
  type TestTextResult,
  type TwilioStatus,
} from "@/lib/smsClient";

/**
 * Is texting actually working?
 *
 * Twilio credentials only exist in the deployment's environment, so nothing on
 * a laptop can answer that. Until this screen existed the first evidence of a
 * mistyped value was a customer saying they never got their confirmation.
 *
 * Two things are reported separately because they fail separately:
 *
 *   Sending   needs the Account SID, a from-number, and either credential
 *   Replies   need TWILIO_AUTH_TOKEN specifically, because Twilio signs
 *             inbound webhooks with the account token and never with an API
 *             key secret
 *
 * An app holding only an API key sends perfectly and silently drops every
 * reply, which is the exact combination worth naming out loud.
 */

type Line = { label: string; ok: boolean; detail: string };

function sendingDetail(status: TwilioStatus): string {
  if (!status.canSend) return status.problem || "Not configured on this deployment.";
  return status.kind === "api-key"
    ? "Using an API key, which can be revoked on its own if it ever leaks."
    : "Using the account auth token.";
}

function repliesDetail(status: TwilioStatus): string {
  if (status.canVerify) {
    return "Replies are checked against Twilio's signature and land on the customer's timeline.";
  }
  // When nothing is configured at all, the sending line above already lists
  // everything to go and set. Naming one variable again here would be the less
  // useful half of an answer already given.
  if (!status.canSend) return status.problem || "Not configured on this deployment.";
  return "TWILIO_AUTH_TOKEN is not set, so replies are refused rather than trusted. Sending still works.";
}

function linesFor(status: TwilioStatus): Line[] {
  return [
    { label: "Sending texts", ok: status.canSend, detail: sendingDetail(status) },
    { label: "Receiving replies", ok: status.canVerify, detail: repliesDetail(status) },
  ];
}

export function TextingStatus() {
  const [status, setStatus] = useState<TwilioStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<TestTextResult | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    void checkTexting()
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch((err: unknown) => {
        if (live) setLoadError(err instanceof Error ? err.message : "Could not check.");
      });
    return () => {
      live = false;
    };
  }, []);

  const test = useCallback(async () => {
    setSending(true);
    setResult(null);
    try {
      const next = await sendTestText();
      setResult(next);
      // The POST reports configuration too, so a value fixed in the dashboard
      // since this screen loaded shows up without a reload.
      setStatus(next);
    } catch (err) {
      setResult({
        kind: "none",
        canSend: false,
        canVerify: false,
        missing: [],
        problem: "",
        hasPhone: false,
        sent: false,
        sid: null,
        tail: "",
        error: err instanceof Error ? err.message : "Could not send.",
      });
    } finally {
      setSending(false);
    }
  }, []);

  return (
    <section>
      <h2 className="mb-2 text-lg font-bold text-ink">Text messaging</h2>

      <div className="flex flex-col gap-2">
        {loadError ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {loadError}
          </p>
        ) : null}

        {status
          ? linesFor(status).map((line) => (
              <div
                key={line.label}
                className="rounded-xl border border-line bg-surface-2 p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`size-2.5 shrink-0 rounded-full ${
                      line.ok ? "bg-money" : "bg-danger-fill"
                    }`}
                  />
                  <p className="text-base font-bold text-ink">
                    {line.label} — {line.ok ? "on" : "off"}
                  </p>
                </div>
                <p className="mt-1 text-sm font-semibold text-muted">{line.detail}</p>
              </div>
            ))
          : loadError
            ? null
            : (
                <p className="text-sm font-semibold text-muted">Checking…</p>
              )}
      </div>

      <Button
        variant="secondary"
        full
        className="mt-3"
        disabled={sending || !status?.canSend}
        onClick={() => void test()}
      >
        {sending ? "Sending…" : "Text myself a test"}
      </Button>

      <p className="mt-2 text-sm font-semibold text-muted">
        {status && !status.hasPhone
          ? "Add your phone number under Your profile first — the test only ever goes to your own number."
          : "Goes to your own number and nowhere near a customer."}
      </p>

      {result ? (
        <p
          role="status"
          className={`mt-2 rounded-xl border px-3 py-2.5 text-base font-semibold text-ink ${
            result.sent
              ? "border-money/60 bg-money/15"
              : "border-danger/60 bg-danger/15"
          }`}
        >
          {result.sent
            ? `Sent to the number ending ${result.tail}. If it doesn't arrive within a minute, the number is registered but the carrier is holding it — that's the A2P registration, not the app.`
            : (result.error ?? "It didn't send.")}
        </p>
      ) : null}
    </section>
  );
}
