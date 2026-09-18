"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  type Auth,
  type ConfirmationResult,
} from "firebase/auth";

/**
 * The customer portal's half of the connection.
 *
 * This site is a static export, so every one of these calls happens in the
 * browser — there is no server here to hold a session. Firebase does the
 * signing in, the CRM API does the reading, and the only thing passed between
 * them is a short-lived ID token.
 *
 * Nothing secret lives in this file. A Firebase web config is public by design:
 * it identifies the project, it does not authorise anything. What authorises a
 * read is the token minted after a code is texted to a handset, and what
 * decides which records that token can see is lib/server/portalAuth.ts in the
 * CRM — server side, where the customer cannot reach it.
 */

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

/** Where the CRM lives. The portal API is there, not on this site. */
export const API_BASE = (process.env.NEXT_PUBLIC_CRM_URL ?? "").replace(/\/+$/, "");

/**
 * Whether the portal can work at all on this deployment.
 *
 * Checked before anything is rendered so a missing environment variable shows
 * a phone number rather than a sign-in form that cannot possibly succeed.
 */
export function portalConfigured(): boolean {
  return Boolean(config.apiKey && config.authDomain && config.projectId && API_BASE);
}

let app: FirebaseApp | null = null;

export function portalAuth(): Auth {
  if (!app) app = getApps()[0] ?? initializeApp(config);
  return getAuth(app);
}

/**
 * Send a six-digit code to a phone number.
 *
 * The reCAPTCHA is Firebase's requirement, not ours — phone auth costs money
 * per message, so it will not mint a code without one. Invisible: it resolves
 * on its own unless Google is suspicious, in which case the customer gets a
 * challenge instead of us silently failing.
 *
 * The verifier is created fresh each time and torn down after. Reusing one
 * across attempts is the documented way to get "reCAPTCHA has already been
 * rendered" on the second try, which reads to a customer as the button being
 * broken.
 */
export async function sendCode(phoneE164: string): Promise<ConfirmationResult> {
  const auth = portalAuth();
  auth.useDeviceLanguage();
  const verifier = new RecaptchaVerifier(auth, "recaptcha-holder", { size: "invisible" });
  try {
    return await signInWithPhoneNumber(auth, phoneE164, verifier);
  } catch (error) {
    verifier.clear();
    throw error;
  }
}

/**
 * A GET against the CRM's portal API, carrying the caller's ID token.
 *
 * `getIdToken()` refreshes when the current one is close to expiry, so this is
 * called per request rather than once at sign-in — a customer reading their
 * history for twenty minutes must not hit a 401 halfway down the page.
 */
export async function portalGet<T>(path: string): Promise<T> {
  const user = portalAuth().currentUser;
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();

  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) {
    // The API's own wording is written for customers to read — "we don't have
    // any records under that number yet" is more use than "404".
    throw new Error(body?.error || "We couldn't reach your account just now.");
  }
  return body as T;
}

/** A POST against the portal API, same token handling. */
export async function portalPost<T>(path: string, payload: unknown): Promise<T> {
  const user = portalAuth().currentUser;
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) throw new Error(body?.error || "That didn't work. Please try again.");
  return body as T;
}

export interface PortalDocument {
  id: string;
  kind: "estimate" | "invoice";
  number: string;
  status: string;
  total: number;
  balanceDue: number;
  createdAtMs: number | null;
  issuedAtMs: number | null;
  serviceType?: string;
}

export interface PortalJob {
  id: string;
  title?: string;
  status: string;
  startMs: number | null;
  serviceType?: string;
}
