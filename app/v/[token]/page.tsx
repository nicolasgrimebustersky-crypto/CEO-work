import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QuoteActions } from "@/components/documents/QuoteActions";
import { SharedDocument } from "@/components/documents/SharedDocument";
import { BUSINESS, BUSINESS_TIMEZONE } from "@/lib/business";
import { todayIn } from "@/lib/quoteResponse";
import { findByShareToken } from "@/lib/server/publicDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The customer's copy, open to anyone holding the link.
 *
 * The whole point of this page is that there is no sign-in. A customer asked
 * to create an account to read their own quote does not read their quote, and
 * the crew end up texting a PDF and a price and hoping.
 *
 * Rendered on the server so the token never reaches a client Firestore rule:
 * the page is either already the document or it is a 404, and there is no
 * request a browser can make from it to ask for a different one.
 */

/**
 * Never indexed.
 *
 * A quote carries a name, an address and a price. Search engines are not the
 * threat model — the link is unguessable — but a page that is crawlable is one
 * misplaced link away from being public in a way nobody intended, and there is
 * no reason for it to be findable by anyone who was not sent it.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function SharedDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await findByShareToken(token);

  // A token that resolves to nothing is a 404, the same answer a made-up one
  // gets. Saying "this quote was withdrawn" would confirm it once existed.
  if (!found) notFound();

  const { document, customer } = found;
  const isInvoice = document.kind === "invoice";

  // An estimate is the only thing there is anything to decide about. An invoice
  // is a bill; offering to "approve" one would be inviting a customer to think
  // they had changed something.
  const decidable = !isInvoice;
  const answered =
    document.status === "accepted" || document.status === "declined"
      ? document.status
      : null;

  return (
    <main className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-3">
        <p className="text-sm font-bold tracking-wide text-muted uppercase">
          {BUSINESS.name}
        </p>
        <h1 className="mt-1 text-xl font-bold text-ink">
          {isInvoice ? "Your invoice" : "Your estimate"}
        </h1>
        <p className="mt-1 text-sm font-semibold text-muted">
          {isInvoice
            ? "Below is your invoice. Any questions, just reply to our text."
            : answered === "accepted"
              ? "You have approved this estimate. We'll confirm the time with you."
              : answered === "declined"
                ? "You let us know this one wasn't right. We'll be in touch."
                : "Have a read, then approve it at the bottom of this page — or tell us what you'd like to ask."}
        </p>
      </div>

      <div className="px-3 pb-8">
        <SharedDocument document={document} customer={customer} />
      </div>

      <footer className="px-4 pb-6 text-center">
        <p className="text-sm font-semibold text-muted">
          {BUSINESS.phone ? `Questions? Call ${BUSINESS.phone}.` : "Questions? Just reply to our text."}
        </p>
      </footer>

      {decidable ? (
        <QuoteActions
          token={token}
          // Decided on the server, in the one timezone the business works in.
          // A phone set to another timezone must not be able to offer, or
          // refuse, a different set of days than the server will accept.
          today={todayIn(BUSINESS_TIMEZONE)}
          alreadyAnswered={answered}
        />
      ) : null}
    </main>
  );
}
