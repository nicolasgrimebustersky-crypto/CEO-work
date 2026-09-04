import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { appendNote } from "@/lib/server/customerNotes";
import { adminDb } from "@/lib/server/admin";
import { notifyCrew } from "@/lib/server/notify";
import { findByShareToken } from "@/lib/server/publicDocument";
import { consumeRateLimit, QUOTE_RESPONSE_LIMIT } from "@/lib/server/rateLimit";
import { formatMoneyExact } from "@/lib/format";
import { SERVICE_LABEL } from "@/lib/status";
import { BUSINESS_TIMEZONE } from "@/lib/business";
import { todayIn, validateQuoteResponse, type QuoteResponseInput } from "@/lib/quoteResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Signature payloads are small but the write fans out to the document, the
// customer timeline and every crew notification. Sixty seconds, matching every
// other route here that does real work.
export const maxDuration = 60;

/**
 * A customer answering their own quote.
 *
 * The only route in the app that writes without a signed-in caller. What
 * authorises it is the share token in the URL and nothing else — so this reads
 * the same way the MCP route does: resolve first, refuse early, and treat every
 * field in the body as text from the open internet.
 *
 * Three deliberate limits, none of them incidental:
 *
 *   1. It can only ever move a document to `accepted` or `declined`, and only
 *      from a state that has not already been answered. A share link cannot
 *      void an invoice, change a price, or reopen something settled.
 *   2. It writes the customer's own record and nobody else's — the customer id
 *      comes from the resolved document, never from the request.
 *   3. It is rate limited per token, so a link that leaks cannot be used to
 *      hammer the database or bury the crew in notifications.
 */

function bad(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/** Statuses a customer may still answer from. */
const ANSWERABLE = new Set(["draft", "sent"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const found = await findByShareToken(token);
  // The same answer a made-up token gets. Saying "already answered" here would
  // confirm the token is real to somebody guessing.
  if (!found) return bad(404, "That link is no longer valid.");

  const { document } = found;

  try {
    await consumeRateLimit(`quote:${document.id}`, "quote_response", QUOTE_RESPONSE_LIMIT);
  } catch {
    return bad(429, "Too many attempts on this quote. Please try again shortly.");
  }

  if (!ANSWERABLE.has(document.status)) {
    // Not an error the customer caused, and worth saying plainly: somebody who
    // taps an old link twice should be told it already went through.
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
        // Attributed to the customer, not to a crew member. Three weeks later
        // the difference between "Nicolas marked this accepted" and "the
        // customer signed it" is the whole point of having a signature.
        updatedBy: "customer",
        updatedByName: signedName,
      });

    await appendNote(document.customerId, {
      text:
        `Approved ${document.number} (${service}, ${money}) online. ` +
        `Signed "${signedName}". Asked for ${requestedDate}.` +
        (message ? ` They said: ${message}` : ""),
      kind: "quote",
      authorUid: "customer",
      authorName: signedName,
    });

    await notifyCrew({
      type: "estimate_accepted",
      body: `${document.customerName} approved ${document.number} — ${money}. Wants ${requestedDate}.`,
      customerId: document.customerId,
      documentId: document.id,
      actorName: signedName || "Customer",
    });

    return Response.json({ ok: true, decision, requestedDate });
  }

  await adminDb()
    .collection("documents")
    .doc(document.id)
    .update({
      status: "declined",
      decline: { message, declinedAt: now },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "customer",
      updatedByName: document.customerName || "Customer",
    });

  await appendNote(document.customerId, {
    text:
      `Declined ${document.number} (${service}, ${money}) online.` +
      (message ? ` They asked: ${message}` : " No message left."),
    kind: "quote",
    authorUid: "customer",
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

  return Response.json({ ok: true, decision });
}
