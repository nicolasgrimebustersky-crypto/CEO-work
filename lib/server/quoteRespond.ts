import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { audit } from "@/lib/server/audit";
import { appendNote } from "@/lib/server/customerNotes";
import { adminDb } from "@/lib/server/admin";
import { notifyCrew } from "@/lib/server/notify";
import { sendEmail } from "@/lib/server/email";
import {
  acceptedEmail,
  customerApprovalEmail,
  declinedEmail,
  readRecipients,
} from "@/lib/emailNotice";
import { routes } from "@/lib/routes";
import { customerFor, type SerialDocument } from "@/lib/server/publicDocument";
import { formatMoneyExact } from "@/lib/format";
import { BUSINESS, BUSINESS_TIMEZONE } from "@/lib/business";
import {
  declineReasonLabel,
  todayIn,
  validateQuoteResponse,
  type QuoteResponseInput,
} from "@/lib/quoteResponse";
import { servicesLabel } from "@/lib/serviceText";

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

  const { decision, signedName, signature, requestedDate, message, reason } = checked.value;
  const now = Timestamp.now();
  const service = servicesLabel(document);
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

    const emailSends = [
      sendEmail(
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
      ),
    ];

    // A receipt for the customer too, when there is an address on file to send
    // it to. Best-effort like the crew notice above — a bad address, a missing
    // customer record or an unconfigured mailer must not turn a signed approval
    // into an error, so the lookup swallows its own failure.
    const customer = await customerFor(document.customerId).catch(() => null);
    const [customerAddress] = readRecipients(customer?.email);
    if (customerAddress) {
      emailSends.push(
        sendEmail(
          customerApprovalEmail({
            customerName: document.customerName,
            number: document.number,
            service,
            total: money,
            requestedDate,
            businessName: BUSINESS.name,
            businessPhone: BUSINESS.phone,
            businessEmail: BUSINESS.email,
          }),
          { to: [customerAddress] },
        ),
      );
    }

    await Promise.all(emailSends);

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
      decline: { message, reason, declinedAt: now },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: responder.uid,
      updatedByName: document.customerName || "Customer",
    });

  const reasonLabel = declineReasonLabel(reason);
  // A decline comment can now run to thousands of words. The timeline note and
  // the document keep all of it; a notification is a phone banner, so it gets
  // the start and a pointer to the rest.
  const preview = message.length > 240 ? `${message.slice(0, 240).trimEnd()}…` : message;

  await appendNote(document.customerId, {
    text:
      `Declined ${document.number} (${service}, ${money}) online.` +
      (reasonLabel ? ` Reason: ${reasonLabel}.` : "") +
      (message ? ` They said: ${message}` : " No message left."),
    kind: "quote",
    authorUid: responder.uid,
    authorName: document.customerName || "Customer",
  });

  await notifyCrew({
    type: "estimate_declined",
    body:
      `${document.customerName} declined ${document.number}` +
      (reasonLabel ? ` — ${reasonLabel}` : ` — ${money}`) +
      (preview ? `. They said: ${preview}` : "."),
    customerId: document.customerId,
    documentId: document.id,
    actorName: document.customerName || "Customer",
  });

  // Emailed like an approval, to the same NOTIFY_EMAIL_TO list. Best-effort in
  // the same way: sendEmail never throws, so a mail problem cannot turn the
  // customer's answer into an error after it has already been saved.
  await sendEmail(
    declinedEmail({
      customerName: document.customerName,
      number: document.number,
      service,
      total: money,
      reason: reasonLabel,
      message,
      documentUrl: documentLink(document.id),
    }),
  );

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
