"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { BUSINESS, BRAND } from "@/lib/business";
import { lineLabel, lineTotal, type BusinessDocument } from "@/lib/documents";
import { formatDateOnly, formatMoneyExact, formatPhone } from "@/lib/format";
import { SERVICE_LABEL } from "@/lib/status";
import { Logo } from "@/components/ui/Logo";
import type { Customer } from "@/lib/types";

/**
 * The version a customer sees.
 *
 * Rendered into a portal at the top of <body> with plain inline styling rather
 * than the app's Tailwind classes: printing is the one place the dark theme is
 * wrong, and a printed page has no theme toggle to fix it. globals.css hides
 * everything else on the page when this prints, so what comes out is just the
 * document — which is also what "Share → PDF" produces on a phone.
 *
 * Colour is used in three places and no more: the header band, the rule under
 * the table head, and the total. A quote that arrives looking like a company
 * wrote it gets accepted more often than one that looks like a spreadsheet
 * printout, and past three accents it starts looking like a flyer instead.
 *
 * `printColorAdjust: exact` is what stops browsers dropping the backgrounds —
 * they strip them by default to save ink, which would leave white text on
 * white paper in the header.
 */
function PrintLogo() {
  return (
    <span
      style={{
        display: "block",
        width: "42px",
        height: "42px",
        flexShrink: 0,
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      <Logo className="" />
    </span>
  );
}

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

  const isInvoice = businessDocument.kind === "invoice";
  const title = isInvoice ? "INVOICE" : "ESTIMATE";

  const solid: React.CSSProperties = {
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  };

  const cell: React.CSSProperties = {
    padding: "9px 6px",
    borderBottom: "1px solid #e6e8ea",
    fontSize: "12px",
    verticalAlign: "top",
  };
  const head: React.CSSProperties = {
    padding: "0 6px 6px",
    borderBottom: `2px solid ${BRAND.ink}`,
    fontWeight: 700,
    textTransform: "uppercase",
    fontSize: "9.5px",
    letterSpacing: "0.08em",
    color: BRAND.ink,
  };
  const totalRow: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    padding: "4px 0",
    fontSize: "12px",
  };
  const label: React.CSSProperties = {
    fontSize: "9.5px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#6b7280",
    margin: 0,
  };

  return createPortal(
    <div
      className="gb-print-root"
      style={{
        fontFamily: "system-ui, -apple-system, Helvetica, Arial, sans-serif",
        color: "#111",
        background: "#fff",
        maxWidth: "760px",
      }}
    >
      {/* Header band */}
      <div
        style={{
          ...solid,
          background: BRAND.ink,
          color: "#fff",
          borderRadius: "10px",
          padding: "18px 20px",
          display: "flex",
          justifyContent: "space-between",
          gap: "24px",
        }}
      >
        <div style={{ display: "flex", gap: "13px", alignItems: "flex-start" }}>
          {/* Inlined rather than an <img>: a print job does not wait for a
              network request, so a referenced logo prints as a blank box. */}
          <PrintLogo />
          <div>
            <p
              style={{
                fontSize: "19px",
                fontWeight: 800,
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              {BUSINESS.name}
            </p>
            <p
              style={{
                ...solid,
                fontSize: "10.5px",
                margin: "3px 0 0",
                color: BRAND.accent,
              }}
            >
              {BUSINESS.tagline}
            </p>
            <p
              style={{
                fontSize: "10.5px",
                margin: "8px 0 0",
                color: "#c9ced4",
              }}
            >
              {BUSINESS.address}
              {BUSINESS.phone ? ` · ${formatPhone(BUSINESS.phone)}` : ""}
              {BUSINESS.email ? ` · ${BUSINESS.email}` : ""}
            </p>
          </div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <p
            style={{
              fontSize: "21px",
              fontWeight: 800,
              margin: 0,
              letterSpacing: "0.08em",
            }}
          >
            {title}
          </p>
          <p style={{ fontSize: "12px", margin: "2px 0 0", color: "#c9ced4" }}>
            #{businessDocument.number}
          </p>
          <p
            style={{ fontSize: "10.5px", margin: "8px 0 0", color: "#c9ced4" }}
          >
            {formatDateOnly(businessDocument.issuedAt)}
          </p>
          {businessDocument.dueAt ? (
            <p style={{ fontSize: "10.5px", margin: 0, color: "#c9ced4" }}>
              {isInvoice ? "Due " : "Good through "}
              {formatDateOnly(businessDocument.dueAt)}
            </p>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: "20px" }}>
        <p style={label}>Prepared for</p>
        <p style={{ fontSize: "15px", fontWeight: 700, margin: "3px 0 0" }}>
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
        <p style={{ fontSize: "12px", margin: "7px 0 0", color: "#4b5563" }}>
          {SERVICE_LABEL[businessDocument.serviceType]}
        </p>
      </div>

      <table
        style={{ width: "100%", borderCollapse: "collapse", marginTop: "20px" }}
      >
        <thead>
          <tr>
            <th style={{ ...head, textAlign: "left" }}>Service</th>
            <th style={{ ...head, textAlign: "right", width: "52px" }}>Qty</th>
            <th style={{ ...head, textAlign: "right", width: "86px" }}>
              Price
            </th>
            <th style={{ ...head, textAlign: "right", width: "96px" }}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {businessDocument.lineItems.map((item) => (
            <tr key={item.id}>
              <td style={{ ...cell, textAlign: "left" }}>
                <span style={{ fontWeight: 700 }}>{lineLabel(item)}</span>
                {/* The line that settles what was included, three weeks later. */}
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
                {formatMoneyExact(lineTotal(item))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: "16px",
        }}
      >
        <div style={{ width: "272px" }}>
          <div style={totalRow}>
            <span style={{ color: "#4b5563" }}>Subtotal</span>
            <span>{formatMoneyExact(businessDocument.subtotal)}</span>
          </div>
          {businessDocument.discount > 0 ? (
            <div style={totalRow}>
              <span style={{ color: "#4b5563" }}>Discount</span>
              <span>−{formatMoneyExact(businessDocument.discount)}</span>
            </div>
          ) : null}
          <div style={totalRow}>
            <span style={{ color: "#4b5563" }}>
              Tax ({businessDocument.taxRatePct}%)
            </span>
            <span>{formatMoneyExact(businessDocument.taxAmount)}</span>
          </div>

          <div
            style={{
              ...solid,
              ...totalRow,
              background: BRAND.moneyWash,
              borderRadius: "8px",
              border: `1.5px solid ${BRAND.money}`,
              padding: "9px 11px",
              marginTop: "7px",
              fontSize: "15px",
              fontWeight: 800,
            }}
          >
            <span>
              {businessDocument.amountPaid > 0 ? "Total" : "Total due"}
            </span>
            <span>{formatMoneyExact(businessDocument.total)}</span>
          </div>

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
            marginTop: "22px",
            borderLeft: `3px solid ${BRAND.accent}`,
            paddingLeft: "11px",
            ...solid,
          }}
        >
          <p style={label}>Notes</p>
          <p
            style={{
              fontSize: "12px",
              margin: "3px 0 0",
              whiteSpace: "pre-wrap",
            }}
          >
            {businessDocument.notes}
          </p>
        </div>
      ) : null}

      <p
        style={{
          marginTop: "30px",
          paddingTop: "11px",
          borderTop: "1px solid #e6e8ea",
          fontSize: "10.5px",
          color: "#6b7280",
        }}
      >
        {BUSINESS.footer}
      </p>
    </div>,
    window.document.body,
  );
}
