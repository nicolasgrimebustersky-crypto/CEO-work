import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { audit } from "@/lib/server/audit";
import { appendNote } from "@/lib/server/customerNotes";
import { adminDb } from "@/lib/server/admin";
import { notifyCrew } from "@/lib/server/notify";
import { sendEmail } from "@/lib/server/email";
import { acceptedEmail } from "@/lib/emailNotice";
import { routes } from "@/lib/routes";
import type { SerialDocument } from "@/lib/server/publicDocument";
import { formatMoneyExact } from "@/lib/format";
import { SERVICE_LABEL } from "@/lib/status";
import { BUSINESS_TIMEZONE } from "@/lib/business";
import { todayIn, validateQuoteResponse, type QuoteResponseInput } from "@/lib/quoteResponse";

/**
 * A customer answering an estimate: approve (with a signature and a date) or
 * decline. Two doors lead here — the share-token link a customer is texted,
 * and the signed-in account portal — and both must do exactly the same thing
 * to the document, the customer's timeline, the crew's notifications and the
 * audit log. So the logic lives once, here, and each door only decides who is
 * allowed through and how the answer is sent back.
 */
export interface RespondResult {
  status: number;
  body: Record<string, unknown>;
}

export interface Responder {
  /** What goes in the audit log and the note's author. "customer" for the token link. */
  uid: string;
}

const bad = (status: number, error: string): RespondResult => ({ status, body: { error } });

export function documentLink(documentId: string): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(site)) return "";
  return `${site}${routes.document(documentId)}`;
}

export const ANSWERABLE = new Set(["draft", "sent"]);

export async function respondToDocument(
  document: SerialDocument,
  request: Request,
  responder: Responder = { uid: "customer" },
): Promise<RespondResult> {
  if (!ANSWERABLE.has(document.status)) {
    return bad(
      409,
      document.status === "accepted"
        ? "This quote has already been approved. We will be in touch."
        : "This quote has already been answered.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad(400, "That did not arrive properly. Please try again.");
  }

  const raw = (body ?? {}) as Partial<QuoteResponseInput>;
  const checked = validateQuoteResponse(
    { ...raw, decision: typeof raw.decision === "string" ? raw.decision : "" },
    todayIn(BUSINESS_TIMEZONE),
  );
  if (!checked.ok) return bad(400, checked.problem);

  const { decision, signedName, signature, requestedDate, message } = checked.value;
  const now = Timestamp.now();
  const service = SERVICE_LABEL[document.serviceType];
  const money = formatMoneyExact(document.total);

  if (decision === "accepted") {
    await adminDb()
      .collection("documents")
      .doc(document.id)
      .update({
        status: "accepted",
        acceptance: {
          signedName,
          signature,
          requestedDate,
          message,
          acceptedAt: now,
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: responder.uid,
        updatedByName: signedName,
      });

    await appendNote(document.customerId, {
      text:
        `Approved ${document.number} (${service}, ${money}) online. ` +
        `Signed "${signedName}". Asked for ${requestedDate}.` +
        (message ? ` They said: ${message}` : ""),
      kind: "quote",
      authorUid: responder.uid,
      authorName: signedName,
    });

    await notifyCrew({
      type: "estimate_accepted",
      body: `${document.customerName} approved ${document.number} — ${money}. Wants ${requestedDate}.`,
      customerId: document.customerId,
      documentId: document.id,
      actorName: signedName || "Customer",
    });

    await sendEmail(
      acceptedEmail({
        customerName: document.customerName,
        number: document.number,
        service,
        total: money,
        requestedDate,
        signedName,
        message,
        documentUrl: documentLink(document.id),
      }),
    );

    await audit({
      action: "quote.answered",
      actorUid: responder.uid,
      actorName: signedName,
      target: document.id,
      ok: true,
      detail: "accepted",
      request,
    });
    return { status: 200, body: { ok: true, decision, requestedDate } };
  }

  await adminDb()
    .collection("documents")
    .doc(document.id)
    .update({
      status: "declined",
      decline: { message, declinedAt: now },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: responder.uid,
      updatedByName: document.customerName || "Customer",
    });

  await appendNote(document.customerId, {
    text:
      `Declined ${document.number} (${service}, ${money}) online.` +
      (message ? ` They asked: ${message}` : " No message left."),
    kind: "quote",
    authorUid: responder.uid,
    authorName: document.customerName || "Customer",
  });

  await notifyCrew({
    type: "estimate_declined",
    body: message
      ? `${document.customerName} declined ${document.number} and asked: ${message}`
      : `${document.customerName} declined ${document.number} — ${money}.`,
    customerId: document.customerId,
    documentId: document.id,
    actorName: document.customerName || "Customer",
  });

  await audit({
    action: "quote.answered",
    actorUid: responder.uid,
    target: document.id,
    ok: true,
    detail: "declined",
    request,
  });
  return { status: 200, body: { ok: true, decision } };
}
