"use client";

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

async function post<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
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
