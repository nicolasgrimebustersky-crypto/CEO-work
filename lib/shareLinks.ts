/**
 * The customer's link to their own estimate.
 *
 * Until now the only way to show somebody their quote was the PDF, shared out
 * of the phone's share sheet, or a CRM URL that stops at a login screen. A
 * customer being asked to create an account to read their own quote is a
 * customer who does not read their quote.
 *
 * So: an unguessable token on the document, and a page that renders the
 * customer's copy to anyone holding it. The token *is* the authorisation,
 * which puts the whole weight of this on it being long and random — 24 bytes
 * from a CSPRNG, the same source the API keys use. Guessing one is not a
 * thing that happens.
 *
 * What it is not is a secret the customer keeps. It will be forwarded, sit in
 * a text thread, and be readable by whoever picks up their phone — which is
 * true of the PDF it replaces, and is why the page shows only what was already
 * going to be handed over. Anything the crew would not print on the quote does
 * not belong on it.
 *
 * Free of imports so the token's shape can be tested directly.
 */

/** 24 bytes → 32 base64url characters. */
export const SHARE_TOKEN_BYTES = 24;

/** The path a share token is served from, without a trailing slash. */
export const SHARE_PATH = "/v";

/** Trims what a copy-paste picks up, so one spelling reaches every check. */
export function normalizeShareToken(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Whether this could be one of ours, before anything is looked up.
 *
 * A cheap shape check in front of a database read: a request for `/v/favicon.ico`
 * or `/v/../admin` is refused without touching Firestore.
 */
export function looksLikeShareToken(value: string | null | undefined): boolean {
  const token = normalizeShareToken(value);
  return /^[A-Za-z0-9_-]{32,64}$/.test(token);
}

/**
 * The absolute link to hand a customer, or null when there is no origin to
 * build it from.
 *
 * Null rather than a relative path on purpose. A relative link is useless in a
 * text message, and a link built from the wrong origin — a preview deployment,
 * say — is worse than none: it works when tested and 404s three weeks later
 * when that deployment is deleted, long after the quote was sent.
 */
export function shareUrl(
  origin: string | null | undefined,
  token: string | null | undefined,
): string | null {
  const base = (origin ?? "").trim().replace(/\/+$/, "");
  const clean = normalizeShareToken(token);
  if (!base || !looksLikeShareToken(clean)) return null;
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}${SHARE_PATH}/${clean}`;
}
