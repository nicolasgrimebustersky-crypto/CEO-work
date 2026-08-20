"use client";

import { useEffect, useState } from "react";

import { Logo } from "@/components/ui/Logo";
import { BRAND, BUSINESS } from "@/lib/business";
import {
  documentLineDiscounts,
  documentSaved,
  lineDiscount,
  lineDiscountPct,
  lineGross,
  lineLabel,
  lineTotal,
  type BusinessDocument,
} from "@/lib/documents";
import { formatDateOnly, formatMoneyExact, formatPhone } from "@/lib/format";
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
  open,
  onClose,
}: {
  document: BusinessDocument;
  customer: Customer | null;
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

  const isInvoice = businessDocument.kind === "invoice";

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
        ),
      );
      if (outcome === "downloaded") {
        setNote("This device can't open a share sheet, so the PDF was downloaded instead.");
      }
    } finally {
      setBusy(false);
    }
  }

  const label: React.CSSProperties = {
    fontSize: "10px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#6b7280",
    margin: 0,
  };
  const cell: React.CSSProperties = {
    padding: "10px 6px",
    borderBottom: "1px solid #e6e8ea",
    fontSize: "12.5px",
    verticalAlign: "top",
  };
  const head: React.CSSProperties = {
    padding: "0 6px 6px",
    borderBottom: `2px solid ${BRAND.ink}`,
    fontWeight: 700,
    textTransform: "uppercase",
    fontSize: "10px",
    letterSpacing: "0.08em",
    color: BRAND.ink,
  };
  const totalRow: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    padding: "5px 0",
    fontSize: "12.5px",
  };

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
        <div
          role="document"
          aria-label={`${isInvoice ? "Invoice" : "Estimate"} ${businessDocument.number}`}
          style={{
            fontFamily: "system-ui, -apple-system, Helvetica, Arial, sans-serif",
            background: "#fff",
            color: "#111",
            // A sheet of US Letter, the same 8.5 x 11 the PDF writer emits.
            // 612pt at 72dpi is the page's real width, so what is on screen is
            // the shape of the thing that lands in the customer's inbox rather
            // than a wide band that happens to hold the same words.
            //
            // `aspectRatio` with `height: auto` sets the height from the width
            // and then *grows* past it when the content is taller, so a long
            // estimate runs on the way a second page would instead of being
            // clipped.
            maxWidth: "612px",
            aspectRatio: "8.5 / 11",
            margin: "0 auto",
            // Proportional to the width so the margin holds its shape as the
            // page scales down on a phone.
            padding: "6%",
            borderRadius: "4px",
            // Paper on a dark screen. Without it the white block reads as a
            // panel of the app rather than as the document itself.
            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.55)",
          }}
        >
          <div
            style={{
              background: BRAND.ink,
              color: "#fff",
              borderRadius: "10px",
              padding: "16px 18px",
              display: "flex",
              justifyContent: "space-between",
              gap: "18px",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <Logo width={150} />
              <div style={{ minWidth: 0, marginTop: "6px" }}>
                <p style={{ fontSize: "10px", margin: 0, color: BRAND.accent }}>
                  {BUSINESS.tagline}
                </p>
                <p style={{ fontSize: "10px", margin: "7px 0 0", color: "#c9ced4" }}>
                  {BUSINESS.address}
                  {BUSINESS.phone ? ` · ${formatPhone(BUSINESS.phone)}` : ""}
                  {BUSINESS.email ? ` · ${BUSINESS.email}` : ""}
                  {BUSINESS.website ? ` · ${BUSINESS.website}` : ""}
                </p>
              </div>
            </div>
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <p style={{ fontSize: "18px", fontWeight: 800, margin: 0, letterSpacing: "0.07em" }}>
                {isInvoice ? "INVOICE" : "ESTIMATE"}
              </p>
              <p style={{ fontSize: "11px", margin: "2px 0 0", color: "#c9ced4" }}>
                #{businessDocument.number}
              </p>
              <p style={{ fontSize: "10px", margin: "7px 0 0", color: "#c9ced4" }}>
                {formatDateOnly(businessDocument.issuedAt)}
              </p>
              {businessDocument.dueAt ? (
                <p style={{ fontSize: "10px", margin: 0, color: "#c9ced4" }}>
                  {isInvoice ? "Due " : "Good through "}
                  {formatDateOnly(businessDocument.dueAt)}
                </p>
              ) : null}
            </div>
          </div>

          <div style={{ marginTop: "18px" }}>
            <p style={label}>Prepared for</p>
            <p style={{ fontSize: "14px", fontWeight: 700, margin: "3px 0 0" }}>
              {businessDocument.customerName || "—"}
            </p>
            {customer?.address ? (
              <p style={{ fontSize: "12px", margin: "1px 0 0", color: "#4b5563" }}>
                {customer.address}
              </p>
            ) : null}
            {customer?.phone ? (
              <p style={{ fontSize: "12px", margin: "1px 0 0", color: "#4b5563" }}>
                {formatPhone(customer.phone)}
              </p>
            ) : null}
            <p style={{ fontSize: "12px", margin: "6px 0 0", color: "#4b5563" }}>
              {SERVICE_LABEL[businessDocument.serviceType]}
            </p>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "18px" }}>
            <thead>
              <tr>
                <th style={{ ...head, textAlign: "left" }}>Service</th>
                <th style={{ ...head, textAlign: "right", width: "46px" }}>Qty</th>
                <th style={{ ...head, textAlign: "right", width: "78px" }}>Price</th>
                <th style={{ ...head, textAlign: "right", width: "88px" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {businessDocument.lineItems.map((item) => (
                <tr key={item.id}>
                  <td style={{ ...cell, textAlign: "left" }}>
                    <span style={{ fontWeight: 700 }}>{lineLabel(item)}</span>
                    {item.name && item.description ? (
                      <span
                        style={{
                          display: "block",
                          marginTop: "2px",
                          fontSize: "11px",
                          color: "#4b5563",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {item.description}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ ...cell, textAlign: "right" }}>{item.quantity}</td>
                  <td style={{ ...cell, textAlign: "right" }}>
                    {formatMoneyExact(item.unitPrice)}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>
                    {/* The full price stays visible, struck through. A discount
                        the customer cannot see is money given away for nothing —
                        they have to be able to tell they were given something. */}
                    {lineDiscount(item) > 0 ? (
                      <span
                        style={{
                          display: "block",
                          fontWeight: 500,
                          color: "#9ca3af",
                          textDecoration: "line-through",
                        }}
                      >
                        {formatMoneyExact(lineGross(item))}
                      </span>
                    ) : null}
                    <span style={{ color: lineDiscount(item) > 0 ? BRAND.money : undefined }}>
                      {formatMoneyExact(lineTotal(item))}
                    </span>
                    {lineDiscount(item) > 0 ? (
                      <span
                        style={{
                          display: "block",
                          marginTop: "2px",
                          fontSize: "10px",
                          fontWeight: 700,
                          color: BRAND.money,
                        }}
                      >
                        {lineDiscountPct(item)}% off · saved{" "}
                        {formatMoneyExact(lineDiscount(item))}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
            <div style={{ width: "260px", maxWidth: "100%" }}>
              <div style={totalRow}>
                <span style={{ color: "#4b5563" }}>Subtotal</span>
                <span>{formatMoneyExact(businessDocument.subtotal)}</span>
              </div>
              {documentLineDiscounts(businessDocument.lineItems) > 0 ? (
                <div style={totalRow}>
                  <span style={{ color: BRAND.money, fontWeight: 700 }}>
                    Line discounts
                  </span>
                  <span style={{ color: BRAND.money, fontWeight: 700 }}>
                    −{formatMoneyExact(documentLineDiscounts(businessDocument.lineItems))}
                  </span>
                </div>
              ) : null}
              {businessDocument.discount > 0 ? (
                <div style={totalRow}>
                  <span style={{ color: "#4b5563" }}>Discount</span>
                  <span>−{formatMoneyExact(businessDocument.discount)}</span>
                </div>
              ) : null}
              <div style={totalRow}>
                <span style={{ color: "#4b5563" }}>Tax ({businessDocument.taxRatePct}%)</span>
                <span>{formatMoneyExact(businessDocument.taxAmount)}</span>
              </div>

              <div
                style={{
                  ...totalRow,
                  background: BRAND.moneyWash,
                  border: `1.5px solid ${BRAND.money}`,
                  borderRadius: "8px",
                  padding: "9px 11px",
                  marginTop: "7px",
                  fontSize: "15px",
                  fontWeight: 800,
                }}
              >
                <span>{businessDocument.amountPaid > 0 ? "Total" : "Total due"}</span>
                <span>{formatMoneyExact(businessDocument.total)}</span>
              </div>

              {/* The headline. Everything above is arithmetic; this is the line
                  the customer repeats to their spouse. */}
              {documentSaved(businessDocument) > 0 ? (
                <div
                  style={{
                    marginTop: "7px",
                    borderRadius: "8px",
                    background: BRAND.money,
                    color: "#04120a",
                    padding: "8px 11px",
                    fontSize: "13px",
                    fontWeight: 800,
                    textAlign: "center",
                    letterSpacing: "0.01em",
                  }}
                >
                  You saved {formatMoneyExact(documentSaved(businessDocument))}
                </div>
              ) : null}

              {businessDocument.amountPaid > 0 ? (
                <>
                  <div style={{ ...totalRow, marginTop: "4px" }}>
                    <span style={{ color: "#4b5563" }}>Paid</span>
                    <span>−{formatMoneyExact(businessDocument.amountPaid)}</span>
                  </div>
                  <div style={{ ...totalRow, fontWeight: 800, fontSize: "14px" }}>
                    <span>Balance due</span>
                    <span>{formatMoneyExact(businessDocument.balanceDue)}</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {businessDocument.notes.trim() ? (
            <div
              style={{
                marginTop: "20px",
                borderLeft: `3px solid ${BRAND.accent}`,
                paddingLeft: "11px",
              }}
            >
              <p style={label}>Notes</p>
              <p style={{ fontSize: "12px", margin: "3px 0 0", whiteSpace: "pre-wrap" }}>
                {businessDocument.notes}
              </p>
            </div>
          ) : null}

          <p
            style={{
              marginTop: "26px",
              paddingTop: "10px",
              borderTop: "1px solid #e6e8ea",
              fontSize: "10px",
              color: "#6b7280",
            }}
          >
            {BUSINESS.footer}
          </p>
        </div>
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
