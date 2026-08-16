import "server-only";

import twilio from "twilio";

/**
 * Twilio credentials are read here and nowhere else. None of these env vars
 * carry the NEXT_PUBLIC_ prefix, so they never reach the browser bundle — an
 * exposed sending credential lets anyone send messages on the account's dime.
 *
 * There are two ways to authenticate, and this supports both:
 *
 *   API key   TWILIO_API_KEY_SID (SK…) + TWILIO_API_KEY_SECRET
 *   Account   TWILIO_AUTH_TOKEN
 *
 * Prefer the API key. It can be deleted in the console the moment it leaks
 * without resetting the account's own token, which means a mistake costs one
 * revocation rather than re-pointing every integration you own. You can also
 * hold several, so rotating is a two-step swap instead of an outage.
 */
const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
const apiKeySid = process.env.TWILIO_API_KEY_SID ?? "";
const apiKeySecret = process.env.TWILIO_API_KEY_SECRET ?? "";
const fromNumber = process.env.TWILIO_PHONE_NUMBER ?? "";

const hasApiKey = apiKeySid.startsWith("SK") && apiKeySecret.length > 0;

/** Enough to send a message. */
export const isTwilioConfigured =
  accountSid.startsWith("AC") &&
  (hasApiKey || authToken.length > 0) &&
  fromNumber.length > 0;

/**
 * Signature validation is a separate capability, and this is the trap in
 * switching to API keys: Twilio signs webhooks with the *account auth token*,
 * never with an API key secret. So an app configured with only an API key can
 * send perfectly well and cannot verify a single inbound request.
 *
 * Rather than let that degrade quietly into an endpoint that accepts forged
 * messages, the inbound route checks this and refuses everything when it is
 * false. See verifyTwilioSignature below.
 */
export const canVerifyWebhooks = authToken.length > 0;

let cachedClient: ReturnType<typeof twilio> | null = null;

function client() {
  if (!isTwilioConfigured) {
    throw new Error(
      "Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_PHONE_NUMBER, and either " +
        "TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET (preferred) or TWILIO_AUTH_TOKEN.",
    );
  }
  // An API key authenticates as itself and names the account it acts on; the
  // auth token *is* the account. Hence the third argument in the first form.
  cachedClient ??= hasApiKey
    ? twilio(apiKeySid, apiKeySecret, { accountSid })
    : twilio(accountSid, authToken);
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
 * endpoint would accept forged messages from anyone who guesses the URL — and a
 * forged message writes into a customer's timeline and buzzes both phones.
 *
 * Always signed with the account auth token, whatever the app sends with.
 */
export function verifyTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature || !canVerifyWebhooks) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}
