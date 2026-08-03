"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { BUSINESS } from "@/lib/business";
import { lineTotal, type BusinessDocument } from "@/lib/documents";
import { formatDateOnly, formatMoneyExact, formatPhone } from "@/lib/format";
import { SERVICE_LABEL } from "@/lib/status";
import type { Customer } from "@/lib/types";

/**
 * The version a customer sees.
 *
 * Rendered into a portal at the top of <body> with plain inline styling rather
 * than the app's Tailwind classes: printing is the one place the dark theme is
 * wrong, and a printed page has no theme toggle to fix it. globals.css hides
 * everything else on the page when this prints, so what comes out is just the
 * document — which is also what "Share → PDF" produces on a phone.
 */
export function DocumentPrintView({
  document: businessDocument,
  customer,
}: {
  document: BusinessDocument;
  customer: Customer | null;
}) {
  // Portals need a real DOM node, which does not exist during the server
  // render. Mounting on the client keeps this out of the SSR output.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const title = businessDocument.kind === "invoice" ? "INVOICE" : "ESTIMATE";
  const cell: React.CSSProperties = {
    padding: "8px 6px",
    borderBottom: "1px solid #ddd",
    fontSize: "12px",
  };
  const head: React.CSSProperties = {
    ...cell,
    borderBottom: "2px solid #000",
    fontWeight: 700,
    textTransform: "uppercase",
    fontSize: "10px",
    letterSpacing: "0.04em",
  };
  const totalRow: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    padding: "4px 0",
    fontSize: "12px",
  };

  return createPortal(
    <div
      className="gb-print-root"
      style={{
        fontFamily: "system-ui, -apple-system, Helvetica, Arial, sans-serif",
        color: "#000",
        background: "#fff",
        maxWidth: "760px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "24px" }}>
        <div>
          <p style={{ fontSize: "20px", fontWeight: 800, margin: 0 }}>{BUSINESS.name}</p>
          <p style={{ fontSize: "11px", margin: "2px 0 0", color: "#555" }}>
            {BUSINESS.tagline}
          </p>
          <p style={{ fontSize: "11px", margin: "6px 0 0", color: "#555" }}>
            {BUSINESS.address}
            {BUSINESS.phone ? ` · ${formatPhone(BUSINESS.phone)}` : ""}
            {BUSINESS.email ? ` · ${BUSINESS.email}` : ""}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: "22px", fontWeight: 800, margin: 0, letterSpacing: "0.06em" }}>
            {title}
          </p>
          <p style={{ fontSize: "12px", margin: "2px 0 0" }}>#{businessDocument.number}</p>
          <p style={{ fontSize: "11px", margin: "6px 0 0", color: "#555" }}>
            Date: {formatDateOnly(businessDocument.issuedAt)}
          </p>
          {businessDocument.dueAt ? (
            <p style={{ fontSize: "11px", margin: 0, color: "#555" }}>
              Due: {formatDateOnly(businessDocument.dueAt)}
            </p>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: "22px", borderTop: "2px solid #000", paddingTop: "12px" }}>
        <p
          style={{
            fontSize: "10px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "#555",
            margin: 0,
          }}
        >
          Bill to
        </p>
        <p style={{ fontSize: "14px", fontWeight: 700, margin: "3px 0 0" }}>
          {businessDocument.customerName || "—"}
        </p>
        {customer?.address ? (
          <p style={{ fontSize: "12px", margin: "1px 0 0", color: "#333" }}>
            {customer.address}
          </p>
        ) : null}
        {customer?.phone ? (
          <p style={{ fontSize: "12px", margin: "1px 0 0", color: "#333" }}>
            {formatPhone(customer.phone)}
          </p>
        ) : null}
        <p style={{ fontSize: "12px", margin: "6px 0 0", color: "#333" }}>
          {SERVICE_LABEL[businessDocument.serviceType]}
        </p>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "18px" }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: "left" }}>Description</th>
            <th style={{ ...head, textAlign: "right", width: "60px" }}>Qty</th>
            <th style={{ ...head, textAlign: "right", width: "90px" }}>Price</th>
            <th style={{ ...head, textAlign: "right", width: "100px" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {businessDocument.lineItems.map((item) => (
            <tr key={item.id}>
              <td style={{ ...cell, textAlign: "left" }}>{item.description}</td>
              <td style={{ ...cell, textAlign: "right" }}>{item.quantity}</td>
              <td style={{ ...cell, textAlign: "right" }}>
                {formatMoneyExact(item.unitPrice)}
              </td>
              <td style={{ ...cell, textAlign: "right" }}>
                {formatMoneyExact(lineTotal(item))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
        <div style={{ width: "260px" }}>
          <div style={totalRow}>
            <span>Subtotal</span>
            <span>{formatMoneyExact(businessDocument.subtotal)}</span>
          </div>
          {businessDocument.discount > 0 ? (
            <div style={totalRow}>
              <span>Discount</span>
              <span>−{formatMoneyExact(businessDocument.discount)}</span>
            </div>
          ) : null}
          <div style={totalRow}>
            <span>Tax ({businessDocument.taxRatePct}%)</span>
            <span>{formatMoneyExact(businessDocument.taxAmount)}</span>
          </div>
          <div
            style={{
              ...totalRow,
              borderTop: "2px solid #000",
              marginTop: "4px",
              paddingTop: "8px",
              fontSize: "15px",
              fontWeight: 800,
            }}
          >
            <span>Total</span>
            <span>{formatMoneyExact(businessDocument.total)}</span>
          </div>
          {businessDocument.amountPaid > 0 ? (
            <>
              <div style={totalRow}>
                <span>Paid</span>
                <span>−{formatMoneyExact(businessDocument.amountPaid)}</span>
              </div>
              <div style={{ ...totalRow, fontWeight: 800 }}>
                <span>Balance due</span>
                <span>{formatMoneyExact(businessDocument.balanceDue)}</span>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {businessDocument.notes.trim() ? (
        <div style={{ marginTop: "20px" }}>
          <p
            style={{
              fontSize: "10px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "#555",
              margin: 0,
            }}
          >
            Notes
          </p>
          <p style={{ fontSize: "12px", margin: "3px 0 0", whiteSpace: "pre-wrap" }}>
            {businessDocument.notes}
          </p>
        </div>
      ) : null}

      <p
        style={{
          marginTop: "28px",
          paddingTop: "10px",
          borderTop: "1px solid #ddd",
          fontSize: "11px",
          color: "#555",
        }}
      >
        {BUSINESS.footer}
      </p>
    </div>,
    window.document.body,
  );
}
