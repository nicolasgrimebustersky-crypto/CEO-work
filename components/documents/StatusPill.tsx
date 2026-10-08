"use client";

import type { Timestamp } from "firebase/firestore";

import { STATUS_LABEL, viewedLabel, type DocumentStatus } from "@/lib/documents";

/**
 * Colour carries the meaning at a glance down a list: green means the money is
 * in or the work is won, yellow means it is sitting with the customer, red
 * means it went nowhere. Anything neutral is grey so the coloured ones stand
 * out rather than competing.
 */
const TONE: Record<DocumentStatus, string> = {
  draft: "border-line bg-surface-3 text-muted",
  sent: "border-warn/60 bg-warn/20 text-ink",
  accepted: "border-ok/60 bg-ok/20 text-ink",
  declined: "border-danger/60 bg-danger/20 text-ink",
  partial: "border-warn/60 bg-warn/25 text-ink",
  paid: "border-ok/70 bg-ok/30 text-ink",
  void: "border-line bg-surface-2 text-muted line-through",
};

/**
 * "Opened" rather than "Sent", once the customer has had the link open.
 *
 * A stronger yellow than plain Sent, because the two mean different things to
 * whoever is scanning the list: Sent may never have arrived, Opened was read
 * and not answered. That second one is the row worth a phone call, so it has
 * to be the one that catches the eye first.
 */
const OPENED_TONE = "border-warn bg-warn/35 text-ink";

export function StatusPill({
  status,
  firstViewedAt = null,
}: {
  status: DocumentStatus;
  /** When the customer first opened their link, if they ever did. */
  firstViewedAt?: Timestamp | null;
}) {
  const label = viewedLabel(status, firstViewedAt);
  const opened = label !== STATUS_LABEL[status];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-bold whitespace-nowrap ${
        opened ? OPENED_TONE : TONE[status]
      }`}
    >
      {label}
    </span>
  );
}
