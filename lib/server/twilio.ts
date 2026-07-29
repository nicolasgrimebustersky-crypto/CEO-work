import "server-only";

import twilio from "twilio";

/**
 * Twilio credentials are read here and nowhere else. None of these env vars
 * carry the NEXT_PUBLIC_ prefix, so they never reach the browser bundle — an
 * exposed auth token lets anyone send messages on the account's dime.
 */
const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
const fromNumber = process.env.TWILIO_PHONE_NUMBER ?? "";

export const isTwilioConfigured =
  accountSid.startsWith("AC") && authToken.length > 0 && fromNumber.length > 0;

let cachedClient: ReturnType<typeof twilio> | null = null;

function client() {
  if (!isTwilioConfigured) {
    throw new Error(
      "Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER.",
    );
  }
  cachedClient ??= twilio(accountSid, authToken);
  return cachedClient;
}

/** US numbers only — that is the entire service area. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (/^\+\d{8,15}$/.test(raw.trim())) return raw.trim();
  return null;
}

export interface SendResult {
  ok: boolean;
  to: string;
  sid?: string;
  error?: string;
}

export async function sendSms(rawTo: string, body: string): Promise<SendResult> {
  const to = toE164(rawTo);
  if (!to) return { ok: false, to: rawTo, error: "Not a valid US phone number." };
  if (!body.trim()) return { ok: false, to, error: "Message body is empty." };

  try {
    const message = await client().messages.create({ to, from: fromNumber, body });
    return { ok: true, to, sid: message.sid };
  } catch (error) {
    return {
      ok: false,
      to,
      error: error instanceof Error ? error.message : "Twilio rejected the message.",
    };
  }
}

/**
 * Validates that a webhook really came from Twilio. Without this the inbound
 * endpoint would accept forged messages from anyone who guesses the URL.
 */
export function verifyTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature || !authToken) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}
