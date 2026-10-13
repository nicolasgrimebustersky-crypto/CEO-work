"use client";

import { TRUST_STORAGE_KEY, parseToken } from "@/lib/trustedDevice";

/**
 * The browser's half of "remember this device".
 *
 * `localStorage` rather than a cookie, deliberately. A cookie would be sent on
 * every request to the origin, including ones that have no business carrying
 * it, and this app is also served to a native shell where cookie behaviour is
 * the host's business rather than ours. The token is read once, posted to one
 * route, and otherwise sits still.
 *
 * Every access is wrapped. Storage throws rather than returning null in a
 * private window, in an embedded webview with data blocked, and on a browser
 * where the user has turned site data off — and the right answer in all three
 * is "this device is not trusted", which is simply the code screen. A sign-in
 * must never fail because a convenience failed.
 */

export function readDeviceToken(): string | null {
  try {
    const raw = window.localStorage.getItem(TRUST_STORAGE_KEY);
    // Parsed on the way out as well as checked on the way in: a half-written
    // value, or one left by an older format, is not worth posting.
    return parseToken(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveDeviceToken(token: string): void {
  try {
    if (!parseToken(token)) return;
    window.localStorage.setItem(TRUST_STORAGE_KEY, token);
  } catch {
    // Nothing to do and nothing to say. The person is signed in either way;
    // they will be asked for a code next time.
  }
}

export function clearDeviceToken(): void {
  try {
    window.localStorage.removeItem(TRUST_STORAGE_KEY);
  } catch {
    // Same.
  }
}
