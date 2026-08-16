"use client";

import { STATUS_LABEL, type DocumentStatus } from "@/lib/documents";

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

export function StatusPill({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-bold whitespace-nowrap ${TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
