import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proving a webhook actually came from Stripe.
 *
 * This is the only thing standing between the open internet and a function that
 * writes payments into the ledger. The endpoint has to be publicly reachable —
 * that is what a webhook is — so anybody can POST to it, and without this check
 * anybody could mark any invoice paid by sending a JSON body that says so.
 *
 * Kept in its own module, away from the network code, for two reasons: it is
 * the piece most worth testing directly, and it must not carry `server-only`
 * with it, which would stop a test importing it at all.
 *
 * Stripe signs `${timestamp}.${rawBody}` with the endpoint's secret and sends
 * the result as `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>]`. Three details
 * in that sentence each matter:
 *
 *   - RAW body. Parsing the JSON and re-serialising it changes the bytes and
 *     the signature no longer matches, which is why the caller must hand over
 *     the exact text it received.
 *   - The timestamp is part of what is signed, so it cannot be edited without
 *     breaking the signature — which is what makes the replay window below
 *     meaningful rather than decorative.
 *   - There can be more than one v1, during a secret rotation. Any one matching
 *     is a pass.
 */

/**
 * How old a signed payload may be.
 *
 * Without this, a webhook captured off the wire stays valid forever and can be
 * replayed to record the same payment again and again. Stripe's own
 * recommendation is five minutes, which is generous enough for a slow retry and
 * short enough that a captured body is stale by the time it is useful.
 */
export const REPLAY_TOLERANCE_MS = 5 * 60 * 1000;

export interface SignatureHeader {
  timestampMs: number;
  signatures: string[];
}

/** Pulls `t` and every `v1` out of the header, or null if it is not that shape. */
export function parseSignatureHeader(header: string): SignatureHeader | null {
  if (typeof header !== "string" || !header) return null;

  let timestampMs = Number.NaN;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") {
      // Seconds on the wire. A non-numeric t is not a header we can use.
      if (!/^\d+$/.test(value)) return null;
      timestampMs = Number(value) * 1000;
    } else if (key === "v1" && /^[0-9a-f]+$/i.test(value)) {
      signatures.push(value.toLowerCase());
    }
  }

  if (!Number.isFinite(timestampMs) || signatures.length === 0) return null;
  return { timestampMs, signatures };
}

/** Constant-time compare of two hex digests, false on any length mismatch. */
function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  // A non-hex string decodes short; comparing the decoded lengths catches that
  // before timingSafeEqual throws on it.
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export interface VerifyResult {
  ok: boolean;
  /** Why not, for the log. Never returned to the caller of the webhook. */
  problem: string;
}

/**
 * Whether this body, with this header, was signed by this secret, recently.
 *
 * Returns rather than throws, so the route can answer 400 and log the reason
 * without a stack trace, and every failure mode reads the same from outside:
 * the caller learns only that it was rejected.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  nowMs: number = Date.now(),
): VerifyResult {
  if (!secret) return { ok: false, problem: "No webhook secret configured." };

  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, problem: "Signature header is missing or malformed." };

  const age = nowMs - parsed.timestampMs;
  // Both directions: a timestamp far in the future is as wrong as a stale one,
  // and allowing it would hand back the replay window this exists to close.
  if (Math.abs(age) > REPLAY_TOLERANCE_MS) {
    return { ok: false, problem: `Signed payload is outside the replay window (${Math.round(age / 1000)}s).` };
  }

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestampMs / 1000}.${rawBody}`, "utf8")
    .digest("hex");

  // Any one match passes: Stripe sends several v1 values while a secret is
  // being rotated, and rejecting the set because one is stale would drop live
  // payments mid-rotation.
  const matched = parsed.signatures.some((signature) => hexEquals(signature, expected));
  return matched ? { ok: true, problem: "" } : { ok: false, problem: "Signature does not match." };
}
