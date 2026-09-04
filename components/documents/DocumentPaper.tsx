"use client";

import { Fragment } from "react";

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
import { SERVICE_LABEL } from "@/lib/status";

/**
 * Only what this page prints.
 *
 * Narrower than `Customer` on purpose. The full record carries door-knock
 * history, a do-not-knock flag and internal notes, and this component renders
 * into a page a stranger with the link can open — so it asks for the two fields
 * it puts on the paper and cannot be handed the rest by accident.
 */
export interface DocumentRecipient {
  address: string;
  phone: string;
}

/**
 * The customer's copy itself — the sheet of paper, and nothing around it.
 *
 * Split out of DocumentPreview when the same document had to appear in a
 * second place: the public link a customer opens without signing in. Two
 * renderings of one quote is how a discount ends up shown on the crew's screen
 * and missing from the copy the customer actually reads, and there is no way
 * to notice that from inside the app.
 *
 * So this holds the layout and nothing else. No actions, no chrome, no
 * knowledge of who is looking — the preview wraps it in Download and Send, the
 * public page wraps it in a header, and neither can change what it says.
 */
function descriptionOf(item: { name: string; description: string }): string {
  return item.name && item.description ? item.description : "";
}

export function DocumentPaper({
  document: businessDocument,
  customer,
}: {
  document: BusinessDocument;
  customer: DocumentRecipient | null;
}) {
  const isInvoice = businessDocument.kind === "invoice";

  const label: React.CSSProperties = {
    fontSize: "10px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#6b7280",
    margin: 0,
  };
  const cell: React.CSSProperties = {
    padding: "10px 4px",
    borderBottom: "1px solid #e6e8ea",
    fontSize: "12.5px",
    verticalAlign: "top",
  };
  /**
   * The service column, and only it, may break inside a word.
   *
   * A service name is a phrase somebody typed and can be arbitrarily long. A
   * price cannot break: "$1,200.00" wrapping after the "0" reads as "$1,200.0"
   * with a stray digit under it, which on a document a customer is agreeing to
   * is worse than any layout problem it solves.
   */
  const serviceCell: React.CSSProperties = {
    ...cell,
    textAlign: "left",
    overflowWrap: "anywhere",
  };
  const moneyCell: React.CSSProperties = {
    ...cell,
    textAlign: "right",
    whiteSpace: "nowrap",
    fontSize: "11.5px",
  };
  const head: React.CSSProperties = {
    padding: "0 4px 6px",
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
        <div style={{ maxWidth: "612px", margin: "0 auto" }}>
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
            // No `aspectRatio` here, deliberately. On a block box it is a
            // *fixed* height rather than a floor — `min-height` defaults to 0 —
            // so an estimate with more lines than fit spilled its text out of
            // the white page onto the dark background behind it, dark-on-dark
            // and unreadable, on the screen the customer is shown. It looked
            // right on every short document. `min-height: fit-content` does not
            // rescue it either; the ratio still wins.
            //
            // The Letter shape is a minimum, and the zero-width float below is
            // what enforces it: a float's padding-top is a percentage of the
            // container's width, so it holds the page open to one page's height
            // and content simply flows past it when there is more.

            // Proportional to the width so the margin holds its shape as the
            // page scales down on a phone.
            padding: "6%",
            borderRadius: "4px",
            // Paper on a dark screen. Without it the white block reads as a
            // panel of the app rather than as the document itself.
            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.55)",
          }}
        >
          {/* Holds the page open to 8.5x11 when there is little on it, and gets
              out of the way when there is more. 133.42% rather than 129.41%
              because a float's padding is measured against the *content* box,
              which the 6% padding has already narrowed. */}
          <div aria-hidden="true" style={{ float: "left", width: 0, paddingTop: "133.42%" }} />
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

          {/* `tableLayout: fixed` with proportional columns rather than pixel
              ones: at 320px the three fixed money columns plus their padding
              left the service column too narrow to hold a word, and the table
              ran off the side of the page. Proportions scale; pixels did not. */}
          <table
            style={{
              width: "100%",
              tableLayout: "fixed",
              borderCollapse: "collapse",
              marginTop: "18px",
            }}
          >
            <thead>
              <tr>
                <th style={{ ...head, textAlign: "left", width: "34%" }}>Service</th>
                <th style={{ ...head, textAlign: "right", width: "10%" }}>Qty</th>
                <th style={{ ...head, textAlign: "right", width: "26%" }}>Price</th>
                <th style={{ ...head, textAlign: "right", width: "30%" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {businessDocument.lineItems.map((item) => (
                <Fragment key={item.id}>
                <tr>
                  <td style={{ ...serviceCell, borderBottom: descriptionOf(item) ? "none" : cell.borderBottom }}>
                    <span style={{ fontWeight: 700 }}>{lineLabel(item)}</span>
                  </td>
                  <td style={moneyCell}>{item.quantity}</td>
                  <td style={moneyCell}>{formatMoneyExact(item.unitPrice)}</td>
                  <td style={{ ...moneyCell, fontWeight: 600 }}>
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
                          // The cell is nowrap so a price cannot break; this
                          // note is a sentence and must be allowed to, or it
                          // runs off the side of the page.
                          whiteSpace: "normal",
                        }}
                      >
                        {lineDiscountPct(item)}% off · saved{" "}
                        {formatMoneyExact(lineDiscount(item))}
                      </span>
                    ) : null}
                  </td>
                </tr>
                {/* The description spans the full width beneath the row rather
                    than sitting inside the service column. That is what the PDF
                    does, and on a phone the narrow column turned every sentence
                    into a ladder of two-word lines while squeezing the money
                    columns until the prices broke in half. */}
                {descriptionOf(item) ? (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        ...cell,
                        paddingTop: 0,
                        fontSize: "11px",
                        color: "#4b5563",
                        whiteSpace: "pre-wrap",
                        textAlign: "left",
                      }}
                    >
                      {descriptionOf(item)}
                    </td>
                  </tr>
                ) : null}
                </Fragment>
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

          {/* Contains the spacer float, so its height counts towards the page
              instead of escaping it. */}
          <div style={{ clear: "both" }} />
        </div>
        </div>
  );
}
