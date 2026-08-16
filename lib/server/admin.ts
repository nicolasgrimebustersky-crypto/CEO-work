import "server-only";

import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Admin SDK, used only inside API routes. It bypasses Firestore security rules
 * entirely, so nothing here may run in response to an unauthenticated request —
 * every route that touches it calls `requireCrew()` first, or verifies the cron
 * secret.
 */

const RAW_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "";

/**
 * Accepts the service-account JSON either raw or base64-encoded. Vercel's env
 * editor mangles multi-line values, so base64 is the recommended form and the
 * one the README documents.
 */
function parseServiceAccount(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} | null {
  if (!RAW_KEY) return null;

  let json = RAW_KEY.trim();
  if (!json.startsWith("{")) {
    try {
      json = Buffer.from(json, "base64").toString("utf8");
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const projectId = typeof parsed.project_id === "string" ? parsed.project_id : "";
    const clientEmail = typeof parsed.client_email === "string" ? parsed.client_email : "";
    const privateKey = typeof parsed.private_key === "string" ? parsed.private_key : "";
    if (!projectId || !clientEmail || !privateKey) return null;

    return {
      projectId,
      clientEmail,
      // Env vars flatten real newlines into the two-character sequence \n.
      privateKey: privateKey.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

export const isAdminConfigured = parseServiceAccount() !== null;

let cachedApp: App | null = null;

function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  if (getApps().length > 0) {
    cachedApp = getApp();
    return cachedApp;
  }

  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is missing or malformed. Server-side routes (SMS, cron) cannot run without it — see the README.",
    );
  }

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
