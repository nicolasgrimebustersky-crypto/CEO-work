/**
 * Verifies a Resend webhook, which Resend signs the Svix way.
 *
 * Headers `svix-id`, `svix-timestamp` and `svix-signature`; the signature is
 * an HMAC-SHA256, keyed with the base64 part of the `whsec_…` secret, over
 * `${id}.${timestamp}.${rawBody}`, sent as one or more space-separated
 * `v1,<base64>` entries. Written out rather than pulled in as a dependency
 * because it is twenty lines and the route that uses it moves money.
 *
 * The timestamp window stops a captured delivery being replayed later.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOLERANCE_SECONDS = 5 * 60;

export function verifySvixSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): { ok: true } | { ok: false; problem: string } {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, problem: "missing signature headers" };
  if (!secret) return { ok: false, problem: "no webhook secret configured" };

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, problem: "bad timestamp" };
  if (Math.abs(nowSeconds - sent) > TOLERANCE_SECONDS) return { ok: false, problem: "timestamp outside tolerance" };

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return { ok: false, problem: "unreadable webhook secret" };
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, problem: "signature mismatch" };
}
