"use client";

import { apiUrl } from "@/lib/apiBase";
import { isDemoMode } from "@/lib/demo/enabled";
import { recordDemoText } from "@/lib/demo/sms";
import { getFirebaseAuth } from "@/lib/firebase";

/**
 * Client half of the SMS API. Twilio credentials live only on the server, so
 * the browser calls these routes with a Firebase ID token and the route does
 * the sending. The token is what proves the caller is one of the two crew
 * accounts.
 */
async function authHeader(): Promise<Record<string, string>> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/**
 * Demo mode has no server, no Twilio account and no phone numbers worth
 * texting. The calls resolve as if they had been sent so the flows can be
 * walked end to end; the banner across the top says nothing is real.
 */
async function fakeSend<T>(path: string, payload: unknown): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (path.endsWith("/blast")) {
    const ids = (payload as { customerIds?: string[] }).customerIds ?? [];
    return { ok: true, attempted: ids.length, sent: ids.length, failed: [] } as T;
  }
  // One-to-one messages land on the customer's timeline the way the real route
  // writes them, so a walkthrough can read what was actually said. See
  // lib/demo/sms.ts.
  const { customerId, body } = payload as { customerId?: string; body?: string };
  if (path.endsWith("/sms/send") && customerId && body) {
    recordDemoText(customerId, body);
  }
  return { ok: true, sid: "DEMO", to: "demo" } as T;
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  if (isDemoMode) return fakeSend<T>(path, payload);

  // apiUrl() is a no-op on the web and points at the deployed backend inside
  // the iOS shell, where the page origin is the app bundle.
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

export function sendSms(
  customerId: string,
  body: string,
  reason = "manual",
): Promise<{ ok: true; sid: string; to: string }> {
  return post("/api/sms/send", { customerId, body, reason });
}

export interface BlastResult {
  ok: true;
  attempted: number;
  sent: number;
  failed: { customerId: string; name: string; error: string }[];
}

export function sendBlast(customerIds: string[], body: string): Promise<BlastResult> {
  return post("/api/sms/blast", { customerIds, body });
}

/**
 * Twilio self-test. `checkTexting` reads what the deployment has configured;
 * `sendTestText` sends one message to the signed-in user's own profile number,
 * which the server reads for itself — the number is never sent from here.
 */
export interface TwilioStatus {
  kind: "api-key" | "auth-token" | "none";
  canSend: boolean;
  canVerify: boolean;
  missing: string[];
  problem: string;
  hasPhone: boolean;
}

export interface TestTextResult extends TwilioStatus {
  sent: boolean;
  sid: string | null;
  /** Last four digits of the number it went to. */
  tail: string;
  error: string | null;
}

const DEMO_STATUS: TwilioStatus = {
  kind: "none",
  canSend: false,
  canVerify: false,
  missing: [],
  problem: "This is the demo. No Twilio account is connected and nothing is sent.",
  hasPhone: true,
};

export async function checkTexting(): Promise<TwilioStatus> {
  if (isDemoMode) return DEMO_STATUS;

  const response = await fetch(apiUrl("/api/sms/test"), { headers: await authHeader() });
  const data = (await response.json().catch(() => ({}))) as TwilioStatus & {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

export function sendTestText(): Promise<TestTextResult> {
  if (isDemoMode) {
    return Promise.resolve({
      ...DEMO_STATUS,
      sent: false,
      sid: null,
      tail: "",
      error: "Nothing is sent in the demo.",
    });
  }
  return post("/api/sms/test", {});
}

/**
 * Job texts are best-effort: the job itself is already saved by the time these
 * run, and a Twilio outage must not make it look like the save failed. Errors
 * come back as a string for the caller to surface as a warning.
 */
export async function trySendSms(
  customerId: string,
  body: string,
  reason: string,
): Promise<string | null> {
  try {
    await sendSms(customerId, body, reason);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Text could not be sent.";
  }
}
