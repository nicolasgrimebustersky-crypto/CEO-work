"use client";

import { useEffect, useState } from "react";

import { DocumentPaper } from "@/components/documents/DocumentPaper";
import type { BusinessDocument } from "@/lib/documents";
import { downloadPdf, sharePdf } from "@/lib/pdf/share";
import { documentText } from "@/lib/messages";
import { SERVICE_LABEL } from "@/lib/status";
import type { Customer } from "@/lib/types";

/**
 * The customer's copy, on screen.
 *
 * Deliberately the same design as the PDF, on white, inside a dark overlay —
 * so what you check before sending is what lands in their messages. Building
 * it in HTML as well as in the PDF writer is duplication, but the alternative
 * is rasterising the PDF to show it, which costs a rendering engine on a phone
 * to display a document the browser can already lay out.
 *
 * Styling is inline rather than themed: this is the one surface in the app
 * that is light, and a stray `text-ink` here would paint white on white.
 */
export function DocumentPreview({
  document: businessDocument,
  customer,
  shareLink,
  open,
  onClose,
}: {
  document: BusinessDocument;
  customer: Customer | null;
  /** The customer's link, when one has been made. Absent is normal. */
  shareLink?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;


  async function onSend() {
    setBusy(true);
    setNote(null);
    try {
      const outcome = await sharePdf(
        businessDocument,
        customer,
        documentText(
          businessDocument.kind,
          SERVICE_LABEL[businessDocument.serviceType],
          businessDocument.total,
          businessDocument.balanceDue,
          shareLink,
        ),
      );
      if (outcome === "downloaded") {
        setNote("This device can't open a share sheet, so the PDF was downloaded instead.");
      }
    } finally {
      setBusy(false);
    }
  }


  return (
    // Fully opaque, not a scrim: this is a light document, and anything
    // showing through from the dark app behind it reads as a rendering fault.
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      <div className="pt-safe flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
        <p className="text-base font-bold text-ink">
          What {customer ? customer.firstName || "they" : "they"} will see
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="tap-target flex items-center justify-center rounded-2xl px-3 text-2xl leading-none text-muted hover:bg-surface-2 hover:text-ink"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-5">
        {/* A sizer, so every percentage inside resolves against the page's own
            width. CSS percentage padding is measured against the *containing
            block*, so with the page itself capped at 612px inside a wider
            column, `padding: 6%` was 6% of the column — and the page came out
            fractionally the wrong shape on a desktop while being right on a
            phone. */}
        <DocumentPaper document={businessDocument} customer={customer} />
      </div>

      <div className="pb-safe shrink-0 border-t border-line bg-surface px-4 pt-3">
        {note ? (
          <p className="mb-2 text-sm font-semibold text-muted">{note}</p>
        ) : null}
        <div className="mx-auto flex max-w-3xl gap-3">
          <button
            type="button"
            onClick={() => void downloadPdf(businessDocument, customer)}
            className="tap-target flex-1 rounded-full border border-line bg-surface-2 px-5 py-3 text-base font-semibold text-ink"
          >
            Download PDF
          </button>
          <button
            type="button"
            onClick={() => void onSend()}
            disabled={busy}
            className="tap-target flex-1 rounded-full bg-accent px-5 py-3 text-base font-semibold text-accent-ink shadow-glow-accent disabled:opacity-50"
          >
            {busy ? "Opening…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
