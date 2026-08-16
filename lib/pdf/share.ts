import { buildDocumentPdf, documentFileName } from "@/lib/pdf/documentPdf";
import { loadLogoImage } from "@/lib/pdf/logoImage";
import type { BusinessDocument } from "@/lib/documents";
import type { Customer } from "@/lib/types";

/**
 * Getting the finished document off the phone.
 *
 * Two routes, and the phone decides which. `navigator.share` with a File
 * attached opens the iOS share sheet, which is how a document actually gets to
 * a customer — Messages, Mail, AirDrop, WhatsApp, whatever they already use.
 * Desktop browsers mostly cannot share a file, so those fall back to a plain
 * download.
 */

async function toBlob(document: BusinessDocument, customer: Customer | null): Promise<Blob> {
  const bytes = buildDocumentPdf(document, customer, await loadLogoImage());
  // Copy into a fresh buffer: the typed array's underlying ArrayBuffer is what
  // Blob wants, and slicing guarantees it is exactly this document's bytes.
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
}

export async function downloadPdf(
  document: BusinessDocument,
  customer: Customer | null,
): Promise<void> {
  const url = URL.createObjectURL(await toBlob(document, customer));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = documentFileName(document);
  window.document.body.append(link);
  link.click();
  link.remove();
  // Freed on the next tick rather than immediately: revoking synchronously
  // cancels the download in some browsers before it has started reading.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ShareOutcome = "shared" | "downloaded" | "cancelled";

/** True when this device can put a PDF into a share sheet. */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try {
    const probe = new File([new Uint8Array([1])], "probe.pdf", { type: "application/pdf" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function sharePdf(
  document: BusinessDocument,
  customer: Customer | null,
  message: string,
): Promise<ShareOutcome> {
  if (!canShareFiles()) {
    await downloadPdf(document, customer);
    return "downloaded";
  }

  const file = new File([await toBlob(document, customer)], documentFileName(document), {
    type: "application/pdf",
  });

  try {
    await navigator.share({
      files: [file],
      title: documentFileName(document).replace(/\.pdf$/, ""),
      text: message,
    });
    return "shared";
  } catch (error) {
    // Dismissing the sheet rejects with AbortError. That is not a failure and
    // must not surface as one — the customer simply changed their mind.
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    await downloadPdf(document, customer);
    return "downloaded";
  }
}
