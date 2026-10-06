/**
 * What is known about where an outbound text ended up.
 *
 * Pure and import-free on purpose. It used to live inside
 * lib/server/twilio.ts, which constructs a Twilio client at module load and so
 * cannot be imported by a test without an account; the rule was therefore
 * pinned by matching the source with a regex, which is not the same thing as
 * knowing it works. It got the rule wrong, and the regex passed.
 *
 * `ok: false` on its own is not something to act on. A failure can mean the
 * service answered and declined, or it can mean nobody knows — and code that
 * undoes its bookkeeping on every failure will, in the second case, send the
 * same message to the same person again.
 */
export type Delivery = "accepted" | "rejected" | "unknown";

/**
 * Classifies a thrown send failure.
 *
 * "rejected" is a promise that nothing was delivered, so it is given only
 * where that is actually true: an HTTP status in the 4xx range, meaning the
 * request was understood, refused, and not processed. Twilio's own error codes
 * for a bad number or a blocked recipient arrive that way.
 *
 * Everything else is "unknown", and the list of what that covers is the point:
 *
 *   5xx — the service broke while handling the request. A 503 says nothing
 *   about whether the message was queued first. This was classified as a
 *   rejection, which released the hold and resent a message that may have
 *   gone out, and left it out of the send cap as well. A server error is the
 *   most likely failure during exactly the kind of outage where resending
 *   everything does the most damage.
 *
 *   no status at all — a timeout, a dropped connection, a DNS failure, a
 *   process killed mid-flight. The request may have been received.
 *
 *   a status that is not a number, or outside both ranges — unrecognised, so
 *   not claimed to be anything.
 *
 * The asymmetry is deliberate. Calling an uncertain failure "unknown" costs
 * one lead a few days and a line in the run's report for somebody to clear.
 * Calling it "rejected" texts a stranger the same message twice.
 */
export function deliveryForFailure(error: unknown): Delivery {
  if (!error || typeof error !== "object") return "unknown";
  const status = (error as { status?: unknown }).status;
  if (typeof status !== "number") return "unknown";
  if (status >= 400 && status < 500) return "rejected";
  return "unknown";
}
