import { BRAND, BUSINESS } from "@/lib/business";
import { lineLabel, lineTotal, type BusinessDocument } from "@/lib/documents";
import { formatDateOnly, formatMoneyExact, formatPhone } from "@/lib/format";
import { SERVICE_LABEL } from "@/lib/status";
import type { Customer } from "@/lib/types";
import { Doc, hexToRgb, PAGE_WIDTH, PT_PER_INCH, type JpegImage } from "./writer";

/**
 * An estimate or invoice as a PDF.
 *
 * Deliberately the same design as the on-screen preview — header band, the
 * service and its description, a green total — so the thing the customer opens
 * is the thing you looked at before sending it.
 *
 * Colour is used three times and no more: the band, the rule under the table
 * head, and the total. A quote that looks like a company wrote it gets
 * accepted more often than one that looks like a spreadsheet printout; past
 * three accents it starts looking like a flyer instead.
 */

const MARGIN = 0.6 * PT_PER_INCH;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = hexToRgb(BRAND.ink);
const ACCENT = hexToRgb(BRAND.accent);
const MONEY = hexToRgb(BRAND.money);
const MONEY_WASH = hexToRgb(BRAND.moneyWash);
const WHITE = { r: 1, g: 1, b: 1 };
const BODY = hexToRgb("#111111");
const MUTED = hexToRgb("#4b5563");
const FAINT = hexToRgb("#9aa3ad");
const HAIRLINE = hexToRgb("#e6e8ea");

/** Right edge of each column, so figures line up on their last digit. */
const COL_AMOUNT = MARGIN + CONTENT_WIDTH;
const COL_PRICE = COL_AMOUNT - 96;
const COL_QTY = COL_PRICE - 86;
const DESCRIPTION_WIDTH = COL_QTY - MARGIN - 68;

export function documentFileName(document: BusinessDocument): string {
  const kind = document.kind === "invoice" ? "Invoice" : "Estimate";
  const who = document.customerName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${kind}-${document.number}${who ? `-${who}` : ""}.pdf`;
}

export function buildDocumentPdf(
  document: BusinessDocument,
  customer: Customer | null,
  /** The lockup. Null when it could not be fetched — see lib/pdf/logoImage.ts. */
  logo: JpegImage | null = null,
): Uint8Array {
  const pdf = new Doc();
  const isInvoice = document.kind === "invoice";

  /* ------------------------------------------------------------- header */

  const bandHeight = logo ? 104 : 92;
  pdf.rect(MARGIN, MARGIN, CONTENT_WIDTH, bandHeight, INK);

  // The lockup already reads as the business name, so when it is present the
  // name is not set again beside it — that would be the same words twice.
  let textLeft = MARGIN + 18;
  if (logo) {
    const logoHeight = 64;
    pdf.drawImage(
      logo,
      MARGIN + 14,
      MARGIN + (bandHeight - logoHeight) / 2,
      (logoHeight * logo.width) / logo.height,
      logoHeight,
    );
    textLeft = MARGIN + 14 + (logoHeight * logo.width) / logo.height + 16;
    pdf.text(BUSINESS.tagline, textLeft, MARGIN + 36, { size: 9, color: ACCENT });
  } else {
    pdf.text(BUSINESS.name, textLeft, MARGIN + 18, {
      size: 17,
      font: "Helvetica-Bold",
      color: WHITE,
    });
    pdf.text(BUSINESS.tagline, textLeft, MARGIN + 42, { size: 9, color: ACCENT });
  }

  const contact = [
    BUSINESS.address,
    BUSINESS.phone ? formatPhone(BUSINESS.phone) : "",
    BUSINESS.email,
    BUSINESS.website,
  ]
    .filter(Boolean)
    .join("  ·  ");
  pdf.text(contact, textLeft, logo ? MARGIN + 54 : MARGIN + 62, { size: 9, color: FAINT });

  const right = MARGIN + CONTENT_WIDTH - 18;
  pdf.text(isInvoice ? "INVOICE" : "ESTIMATE", right, MARGIN + 17, {
    size: 19,
    font: "Helvetica-Bold",
    color: WHITE,
    align: "right",
  });
  pdf.text(`#${document.number}`, right, MARGIN + 40, {
    size: 11,
    color: FAINT,
    align: "right",
  });
  pdf.text(formatDateOnly(document.issuedAt), right, MARGIN + 58, {
    size: 9,
    color: FAINT,
    align: "right",
  });
  if (document.dueAt) {
    pdf.text(
      `${isInvoice ? "Due" : "Good through"} ${formatDateOnly(document.dueAt)}`,
      right,
      MARGIN + 72,
      { size: 9, color: FAINT, align: "right" },
    );
  }

  /* --------------------------------------------------------- prepared for */

  let y = MARGIN + bandHeight + 24;
  pdf.text("PREPARED FOR", MARGIN, y, { size: 8, font: "Helvetica-Bold", color: MUTED });
  y += 14;
  pdf.text(document.customerName || "—", MARGIN, y, {
    size: 13,
    font: "Helvetica-Bold",
    color: BODY,
  });
  y += 17;
  if (customer?.address) {
    pdf.text(customer.address, MARGIN, y, { size: 10, color: MUTED });
    y += 14;
  }
  if (customer?.phone) {
    pdf.text(formatPhone(customer.phone), MARGIN, y, { size: 10, color: MUTED });
    y += 14;
  }
  pdf.text(SERVICE_LABEL[document.serviceType], MARGIN, y + 4, { size: 10, color: MUTED });
  y += 30;

  /* ---------------------------------------------------------------- lines */

  const headOptions = { size: 8, font: "Helvetica-Bold" as const, color: INK };
  pdf.text("SERVICE", MARGIN, y, headOptions);
  pdf.text("QTY", COL_QTY, y, { ...headOptions, align: "right" });
  pdf.text("PRICE", COL_PRICE, y, { ...headOptions, align: "right" });
  pdf.text("AMOUNT", COL_AMOUNT, y, { ...headOptions, align: "right" });
  y += 13;
  pdf.line(MARGIN, y, CONTENT_WIDTH, INK, 1.2);
  y += 11;

  for (const item of document.lineItems) {
    const rowTop = y;
    pdf.text(lineLabel(item), MARGIN, y, { size: 10.5, font: "Helvetica-Bold", color: BODY });
    pdf.text(String(item.quantity), COL_QTY, y, { size: 10, color: BODY, align: "right" });
    pdf.text(formatMoneyExact(item.unitPrice), COL_PRICE, y, {
      size: 10,
      color: BODY,
      align: "right",
    });
    pdf.text(formatMoneyExact(lineTotal(item)), COL_AMOUNT, y, {
      size: 10,
      font: "Helvetica-Bold",
      color: BODY,
      align: "right",
    });
    y += 15;

    // The line that settles what was included, three weeks later.
    if (item.name && item.description) {
      y = pdf.paragraph(item.description, MARGIN, y, DESCRIPTION_WIDTH, {
        size: 9,
        color: MUTED,
      });
    }

    y = Math.max(y, rowTop + 20) + 7;
    pdf.line(MARGIN, y, CONTENT_WIDTH, HAIRLINE, 0.6);
    y += 11;
  }

  /* --------------------------------------------------------------- totals */

  const totalsLeft = MARGIN + CONTENT_WIDTH - 250;
  const money = (label: string, value: string, bold = false) => {
    pdf.text(label, totalsLeft, y, { size: 10, color: MUTED });
    pdf.text(value, COL_AMOUNT, y, {
      size: 10,
      font: bold ? "Helvetica-Bold" : "Helvetica",
      color: BODY,
      align: "right",
    });
    y += 16;
  };

  y += 4;
  money("Subtotal", formatMoneyExact(document.subtotal));
  if (document.discount > 0) money("Discount", `-${formatMoneyExact(document.discount)}`);
  money(`Tax (${document.taxRatePct}%)`, formatMoneyExact(document.taxAmount));

  // The one number the customer is looking for.
  y += 4;
  pdf.rect(totalsLeft - 12, y, 262, 32, MONEY_WASH);
  pdf.rect(totalsLeft - 12, y, 262, 1.4, MONEY);
  pdf.rect(totalsLeft - 12, y + 30.6, 262, 1.4, MONEY);
  pdf.text(document.amountPaid > 0 ? "Total" : "Total due", totalsLeft, y + 10, {
    size: 12.5,
    font: "Helvetica-Bold",
    color: BODY,
  });
  pdf.text(formatMoneyExact(document.total), COL_AMOUNT, y + 10, {
    size: 12.5,
    font: "Helvetica-Bold",
    color: BODY,
    align: "right",
  });
  y += 44;

  if (document.amountPaid > 0) {
    money("Paid", `-${formatMoneyExact(document.amountPaid)}`);
    money("Balance due", formatMoneyExact(document.balanceDue), true);
  }

  /* ---------------------------------------------------------------- notes */

  if (document.notes.trim()) {
    y += 14;
    const noteTop = y;
    pdf.text("NOTES", MARGIN + 12, y, { size: 8, font: "Helvetica-Bold", color: MUTED });
    y += 13;
    y = pdf.paragraph(document.notes, MARGIN + 12, y, CONTENT_WIDTH - 12, {
      size: 10,
      color: BODY,
    });
    pdf.rect(MARGIN, noteTop - 2, 2.5, y - noteTop + 2, ACCENT);
  }

  /* --------------------------------------------------------------- footer */

  const footerY = Math.max(y + 26, 10.1 * PT_PER_INCH);
  pdf.line(MARGIN, footerY, CONTENT_WIDTH, HAIRLINE, 0.6);
  pdf.paragraph(BUSINESS.footer, MARGIN, footerY + 10, CONTENT_WIDTH, {
    size: 9,
    color: MUTED,
  });

  return pdf.build();
}
