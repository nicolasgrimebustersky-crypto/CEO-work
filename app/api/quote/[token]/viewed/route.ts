import { ApiError } from "@/lib/server/auth";
import { recordDocumentView } from "@/lib/server/documentViews";
import { findByShareToken } from "@/lib/server/publicDocument";
import { consumeRateLimit, QUOTE_VIEW_LIMIT } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A customer's browser saying "I have this open".
 *
 * The second route in the app that writes without a signed-in caller, and it
 * is modelled on the first: resolve the token before anything else, refuse
 * early, and trust nothing in the request but the token itself. There is no
 * body — the only thing it can say is "this token was opened", and even the
 * document id comes from resolving the token rather than from the caller.
 *
 * Called from the page after it renders rather than during the render, which
 * is the whole reason the stamp is worth anything. Link previews in iMessage,
 * WhatsApp, Messenger, Slack and Outlook fetch a URL as soon as it is sent;
 * recording during the render would mark every estimate opened seconds after
 * it went out, by the preview bot. Those fetchers do not run JavaScript.
 *
 * It answers 204 whatever happens past the token check. The browser has
 * nothing to do with the result, and a response that distinguished "first
 * open" from "opened again" would hand somebody holding a leaked link a way to
 * ask questions about the record.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const found = await findByShareToken(token);
  // The same silent answer a made-up token gets, for the same reason the
  // response route gives one: a different reply here would confirm which
  // tokens are real to somebody guessing.
  if (!found) return new Response(null, { status: 204 });

  try {
    await consumeRateLimit(`quoteview:${found.document.id}`, "quote_view", QUOTE_VIEW_LIMIT);
  } catch (error) {
    // Over the limit is not worth telling the page about: it is already open,
    // and the stamp that matters was set on the first call.
    //
    // Anything else thrown here is the limiter itself failing — its own
    // Firestore transaction losing a race, a cold start timing out — and
    // swallowing that would throw away a genuine first open to protect a
    // counter. The stamp is the point; the limit is the guard rail. So only
    // the refusal stops us.
    if (error instanceof ApiError && error.status === 429) {
      return new Response(null, { status: 204 });
    }
  }

  try {
    await recordDocumentView(found.document.id);
  } catch {
    // A failed stamp must never break the customer's view of their own quote.
    // The page is already rendered; this is bookkeeping behind it.
  }

  return new Response(null, { status: 204 });
}
