"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { importOldReplies, type ReplyImportResult } from "@/lib/smsClient";

/**
 * Bringing in the replies that arrived before texts were connected.
 *
 * Twilio kept every reply customers sent while the business number had
 * nowhere to forward them. One tap reads that log and files each reply on the
 * right client, with the time it was really sent and the blue dot on the
 * client so it is plain who wrote back. Safe to tap again: nothing is filed
 * twice.
 */
export function ImportReplies() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReplyImportResult | null>(null);
  const [error, setError] = useState("");

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setResult(await importOldReplies());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import replies.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-line bg-surface-2 p-3">
      <h2 className="text-base font-bold text-ink">Replies from before texts were connected</h2>
      <p className="mt-1 text-sm text-muted">
        Twilio kept every text customers sent back. This adds them to each client&rsquo;s
        conversation and puts a blue dot on whoever replied. Safe to run again &mdash; nothing is
        added twice.
      </p>

      {result ? (
        <p className="mt-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-ink">
          {summary(result)}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-sm font-semibold text-ink">
          {error}
        </p>
      ) : null}

      <Button variant="secondary" className="mt-3" onClick={run} disabled={busy}>
        {busy ? "Importing…" : "Import old replies"}
      </Button>
    </section>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function summary(result: ReplyImportResult): string {
  if (result.filed === 0 && result.unknownNumbers === 0) {
    return result.alreadyFiled > 0
      ? "Nothing new — every reply is already in the CRM."
      : "No replies found in Twilio's log.";
  }
  const parts = [
    `Added ${plural(result.filed, "reply", "replies")} to ${plural(result.customers, "client", "clients")}.`,
  ];
  if (result.unknownNumbers > 0) {
    parts.push(
      `${plural(result.unknownNumbers, "text", "texts")} from numbers not on file ${
        result.unknownNumbers === 1 ? "is" : "are"
      } listed at the top of this screen.`,
    );
  }
  if (result.optOuts > 0) {
    parts.push(`${plural(result.optOuts, "client", "clients")} had replied STOP and ${
      result.optOuts === 1 ? "is" : "are"
    } now marked do not text.`);
  }
  if (result.truncated) parts.push("Twilio's log was too long to read in full, so the oldest replies were left out.");
  return parts.join(" ");
}
