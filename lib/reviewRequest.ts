/**
 * Asking for a Google review, once, when the money is actually in hand.
 *
 * The trigger is the last tap of the on-site flow: en route, started, finished,
 * then sign-off, where the crew member answers whether they were paid. A yes
 * there is the one moment in the whole job where the customer is satisfied, the
 * work is fresh, and nobody owes anybody anything — which is the only moment
 * worth asking in.
 *
 * Pure, and free of imports, so every one of the conditions below can be tested
 * by running it. That matters more here than usual: the failure mode is texting
 * a customer twice, or texting one who did not pay, and neither shows up in a
 * test that only checks the happy path.
 */

/** Anything with a millisecond stamp — Firestore's Timestamp satisfies it. */
interface Stamp {
  toMillis(): number;
}

export interface ReviewAskInput {
  /** What the crew member answered at sign-off. Null means nobody was asked. */
  paymentCollected: boolean | null;
  /** Set once a request has gone out, so this never fires twice for one job. */
  reviewRequestedAt?: Stamp | null;
  /** Where to send them. Empty when the business has not configured one. */
  reviewUrl: string;
  /** The customer's number, as held on their record. */
  customerPhone?: string | null;
}

export type ReviewAskVerdict =
  | { ask: true }
  | { ask: false; reason: string };

/**
 * Whether to send the review request.
 *
 * Every "no" carries a reason rather than being a bare false. They are not
 * shown to the customer — they go in the crew-facing note and the timeline —
 * but "nothing happened" is the hardest kind of bug to chase on a feature that
 * fires from a button somebody pressed once, on a driveway, a week ago.
 */
export function shouldAskForReview(input: ReviewAskInput): ReviewAskVerdict {
  // Not a rounding of "we'll invoice them later" into a thank-you for paying.
  // `null` is its own answer: nobody was asked, which is not a yes.
  if (input.paymentCollected !== true) {
    return { ask: false, reason: "payment was not collected on site" };
  }

  if (input.reviewRequestedAt != null) {
    // A second ask is not twice as likely to get a review; it is how a
    // thank-you becomes nagging, and how a business gets reported as spam.
    return { ask: false, reason: "a review was already requested for this job" };
  }

  if (!(input.reviewUrl ?? "").trim()) {
    return { ask: false, reason: "no Google review link is configured" };
  }

  if (!(input.customerPhone ?? "").trim()) {
    return { ask: false, reason: "this customer has no phone number on file" };
  }

  return { ask: true };
}

/**
 * The configured review link, or "" if there isn't a usable one.
 *
 * Validated rather than trusted, because the value arrives by someone pasting
 * it into a dashboard: a link that is not a link goes out to every paying
 * customer before anybody notices, and each one is a real text to a real person
 * that cannot be recalled.
 *
 * Only http(s) passes. A `javascript:` or `data:` URL in a text message is
 * useless at best, and this string is one that ends up in front of customers.
 */
export function normalizeReviewUrl(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}
