import "server-only";

import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import {
  describeServiceAccountKey,
  parseServiceAccountKey,
} from "@/lib/serviceAccountKey";

/**
 * Admin SDK, used only inside API routes. It bypasses Firestore security rules
 * entirely, so nothing here may run in response to an unauthenticated request —
 * every route that touches it calls `requireCrew()` first, or verifies the cron
 * secret.
 */

const RAW_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "";

/**
 * Accepts the service-account JSON either raw or base64-encoded, and tolerates
 * what a dashboard paste does to it. The reading itself lives in
 * lib/serviceAccountKey.ts, which imports nothing and is therefore tested
 * against every mangled shape rather than trusted.
 */
const parseServiceAccount = () => parseServiceAccountKey(RAW_KEY);

export const isAdminConfigured = parseServiceAccount() !== null;

/**
 * Why it could not be read, for the operator. Empty string when all is well.
 * Never contains the value — it is a private key.
 */
export function serviceAccountProblem(): string {
  return describeServiceAccountKey(RAW_KEY);
}

let cachedApp: App | null = null;

function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  if (getApps().length > 0) {
    cachedApp = getApp();
    return cachedApp;
  }

  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) throw new Error(serviceAccountProblem());

  cachedApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.projectId,
  });
  return cachedApp;
}

export function adminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function adminAuth(): Auth {
  return getAuth(getAdminApp());
}

/**
 * The project's storage bucket, for handing a customer a short-lived link to a
 * file attached to their document. Named by the same variable the client uses,
 * so the two can never point at different buckets.
 */
export function adminBucket() {
  const name = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";
  if (!name) throw new Error("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set.");
  return getStorage(getAdminApp()).bucket(name);
}
