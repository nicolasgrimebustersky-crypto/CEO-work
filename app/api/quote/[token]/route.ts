import { findByShareToken } from "@/lib/server/publicDocument";
import { respondToDocument } from "@/lib/server/quoteRespond";
import { consumeRateLimit, QUOTE_RESPONSE_LIMIT } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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

  const result = await respondToDocument(document, request);
  return Response.json(result.body, { status: result.status });
}
