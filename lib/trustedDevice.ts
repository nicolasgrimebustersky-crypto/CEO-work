/**
 * Trusting a phone, so the sign-in code is asked for once a month rather than
 * every time.
 *
 * What this does and does not change is the whole of it. The security rules
 * are untouched: `hasVerifiedSession()` still requires this sign-in's
 * `auth_time` to be in the account's `otpAuths` claim, and nothing reaches a
 * customer record without it. What changes is how that claim can be earned.
 * Before, only typing the six digits granted it. Now a device that has already
 * typed them once can present a secret it was given at the time, and the
 * server grants the claim on that instead.
 *
 * So the honest description of the trade: on a trusted phone, the password
 * becomes the only thing standing between somebody and the app, for thirty
 * days. That is a real reduction and it is the thing being asked for — a code
 * on every sign-in is a second factor nobody keeps using, and a factor that
 * gets worked around is worse than one that is scoped deliberately. It is
 * scoped three ways: the trust expires, it belongs to one account, and it can
 * be revoked from the Account screen without touching the password.
 *
 * Four properties the rest of this feature exists to hold:
 *
 *   The secret is never stored. A salted hash is, exactly as `lib/server/otp.ts`
 *   stores the code, so a dump of the database grants nobody anything.
 *
 *   It is bound to one uid. A token lifted from one account cannot verify
 *   another, even on the same handset.
 *
 *   It expires on the server's clock. A client that lies about the date gets
 *   nothing, because the client is never asked.
 *
 *   It is a second factor only. The password is still required first — this
 *   is never a way in on its own, and the redemption route refuses anybody who
 *   is not already signed in as approved crew.
 *
 * Pure and import-free, so every one of those refusals can be tested by
 * calling a function.
 */

/** How long a device stays trusted. The number in the checkbox's own label. */
export const TRUST_DAYS = 30;

export const TRUST_MS = TRUST_DAYS * 24 * 60 * 60 * 1000;

/** Where the browser keeps its half. Per origin, so preview and production differ. */
export const TRUST_STORAGE_KEY = "gb.trustedDevice.v1";

/**
 * The token, as the client holds it: an id and a secret, joined by a dot.
 *
 * Two parts rather than one, because the server has to find the record before
 * it can check the secret, and looking a record up *by* the secret would mean
 * indexing the secret — which is the one thing that must never be stored in a
 * form anybody can search. The id is public and useless alone.
 */
export interface DeviceToken {
  id: string;
  secret: string;
}

export function composeToken(token: DeviceToken): string {
  return `${token.id}.${token.secret}`;
}

/**
 * Splits a stored token, refusing anything that is not exactly two parts.
 *
 * Deliberately strict. A token with a stray dot, an empty half, or characters
 * outside the alphabet the server generates is not a near-miss worth
 * forgiving: it is corruption or tampering, and both answer the same way.
 */
export function parseToken(raw: unknown): DeviceToken | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const parts = trimmed.split(".");
  if (parts.length !== 2) return null;

  const [id, secret] = parts;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret)) return null;

  return { id, secret };
}

/** The stored record's shape, as the checks below need it. */
export interface TrustedDeviceRecord {
  uid: string;
  expiresAtMs: number;
  revoked: boolean;
}

export type TrustVerdict =
  | { ok: true }
  | { ok: false; reason: "unknown" | "wrong-account" | "revoked" | "expired" };

/**
 * Whether a stored record may verify this sign-in, and why not.
 *
 * Split out from the database call so the ladder is testable without one, and
 * ordered so the least informative answer wins: a token for another account
 * reports the same way to the caller as one that does not exist, because
 * telling somebody holding a stolen token that it is valid *somewhere* is a
 * fact they did not have.
 */
export function checkTrust(
  record: TrustedDeviceRecord | null,
  uid: string,
  nowMs: number,
): TrustVerdict {
  if (!record) return { ok: false, reason: "unknown" };
  if (record.uid !== uid) return { ok: false, reason: "wrong-account" };
  if (record.revoked) return { ok: false, reason: "revoked" };
  // `<=` rather than `<`: a token expiring exactly now has expired. The
  // direction a boundary has to fail in.
  if (record.expiresAtMs <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** When a device trusted now stops being trusted. */
export function expiryFrom(nowMs: number): number {
  return nowMs + TRUST_MS;
}

/** Whole days left, floored, never negative. For the Account screen. */
export function daysLeft(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((expiresAtMs - nowMs) / (24 * 60 * 60 * 1000)));
}

/**
 * A short name for a device, from its user agent.
 *
 * Only so "forget this device" is a sentence about something recognisable
 * rather than a row of hex. Deliberately coarse — the point is to tell two
 * phones apart, not to fingerprint one, and anything finer would be
 * identifying information kept for no reason.
 */
export function deviceLabel(userAgent: unknown): string {
  const ua = typeof userAgent === "string" ? userAgent : "";
  const platform = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? "Android phone"
        : /Macintosh|Mac OS/i.test(ua)
          ? "Mac"
          : /Windows/i.test(ua)
            ? "Windows PC"
            : "";
  const browser = /CriOS|Chrome/i.test(ua)
    ? "Chrome"
    : /FxiOS|Firefox/i.test(ua)
      ? "Firefox"
      : /Edg/i.test(ua)
        ? "Edge"
        : /Safari/i.test(ua)
          ? "Safari"
          : "";

  if (platform && browser) return `${platform} · ${browser}`;
  if (platform) return platform;
  if (browser) return browser;
  return "Unknown device";
}
