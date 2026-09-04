import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { adminDb } from "./admin";
import { ApiError } from "./auth";

/**
 * Per-user rate limiting for the routes that cost money.
 *
 * A stolen or borrowed session already passes `requireCrew()` — the allowlist
 * proves *who* is calling, not *how much* they may spend. Without a ceiling,
 * one compromised phone could run the Twilio balance to zero in minutes, and
 * every message would look perfectly authorised on the way out.
 *
 * Counters live in Firestore rather than in memory because serverless
 * instances do not share memory: an in-process limiter would reset on every
 * cold start and could be trivially evaded by parallel requests landing on
 * different instances. The `rateLimits` collection is intentionally absent
 * from firestore.rules, so no client can read or tamper with it — only the
 * Admin SDK reaches it.
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
  /** Shown to the user when they hit it. */
  label: string;
}

export const SMS_SEND_LIMIT: RateLimitRule = {
  max: 40,
  windowMs: 60 * 60 * 1000,
  label: "one-off texts",
};

/** Each blast can be up to 200 messages, so the ceiling is much lower. */
export const SMS_BLAST_LIMIT: RateLimitRule = {
  max: 4,
  windowMs: 60 * 60 * 1000,
  label: "group texts",
};

/**
 * The self-test only ever reaches your own phone, so the risk is not toll fraud
 * — it is holding the button down and burning a carrier's patience for
 * duplicate traffic. A handful an hour is more than enough to prove the wiring.
 */
export const SMS_TEST_LIMIT: RateLimitRule = {
  max: 5,
  windowMs: 60 * 60 * 1000,
  label: "test texts",
};

/**
 * Each draft is a model call the business pays for, and the button sits on a
 * screen somebody taps while distracted. Thirty an hour is far more estimates
 * than two people can write in an hour, and a low enough ceiling that a stuck
 * finger cannot run up a bill.
 */
export const ESTIMATE_DRAFT_LIMIT: RateLimitRule = {
  max: 30,
  windowMs: 60 * 60 * 1000,
  label: "drafted estimates",
};

/**
 * The agent's ordinary budget. Generous — an agent answering a question may
 * legitimately make a handful of calls — but bounded, because a looping agent
 * with a valid key would otherwise read the whole book repeatedly.
 */
export const MCP_LIMIT: RateLimitRule = {
  max: 240,
  windowMs: 60 * 60 * 1000,
  label: "agent requests",
};

/**
 * And a much tighter one for anything that reaches a customer.
 *
 * Twenty texts an hour is more than an agent should ever need and few enough
 * that a stuck loop is an embarrassment rather than a catastrophe. A text
 * cannot be unsent.
 */
export const MCP_SEND_LIMIT: RateLimitRule = {
  max: 20,
  windowMs: 60 * 60 * 1000,
  label: "agent messages to customers",
};

/**
 * A customer answering their own quote.
 *
 * Low, because there is nothing legitimate past a handful: approve, or decline
 * and maybe fix a typo in the question. It is keyed on the document rather than
 * the caller, since there is no caller — which also means a leaked link cannot
 * be used to bury the crew in notifications about one quote.
 */
export const QUOTE_RESPONSE_LIMIT: RateLimitRule = {
  max: 12,
  windowMs: 60 * 60 * 1000,
  label: "answers to this quote",
};

function minutesUntil(resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 60000));
}

/**
 * Consumes one unit of the caller's budget, or throws ApiError(429).
 *
 * The read-modify-write runs in a transaction so two requests racing on
 * separate instances cannot both read the same count and each write back
 * count+1, which would let the limit be doubled under exactly the concurrency
 * it exists to stop.
 */
export async function consumeRateLimit(
  uid: string,
  route: string,
  rule: RateLimitRule,
  cost = 1,
): Promise<void> {
  const db = adminDb();
  const ref = db.collection("rateLimits").doc(`${uid}__${route}`);

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();

    const data = snap.exists ? (snap.data() ?? {}) : {};
    const windowStart =
      data.windowStart instanceof Timestamp ? data.windowStart.toMillis() : 0;
    const used = typeof data.count === "number" ? data.count : 0;

    // Fixed window: once it lapses the counter starts over from this request.
    const expired = now - windowStart >= rule.windowMs;
    const nextCount = expired ? cost : used + cost;
    const nextStart = expired ? now : windowStart;

    if (nextCount > rule.max) {
      return { allowed: false as const, resetAt: nextStart + rule.windowMs };
    }

    tx.set(
      ref,
      {
        count: nextCount,
        windowStart: Timestamp.fromMillis(nextStart),
        updatedAt: Timestamp.fromMillis(now),
      },
      { merge: true },
    );
    return { allowed: true as const, resetAt: nextStart + rule.windowMs };
  });

  if (!outcome.allowed) {
    throw new ApiError(
      429,
      `Rate limit reached for ${rule.label} (${rule.max} per hour). Try again in about ${minutesUntil(outcome.resetAt)} minutes.`,
    );
  }
}
