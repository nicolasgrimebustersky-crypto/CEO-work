/**
 * Deciding which Twilio credential to send with.
 *
 * Pulled out of lib/server/twilio.ts and made pure so it can be tested by
 * running it. The logic is small and the failure modes are all silent, which is
 * the worst combination there is:
 *
 *   Pick wrong and every text fails with an authentication error nobody sees
 *   until a customer says they never got confirmation.
 *
 *   Get `canVerify` wrong in the permissive direction and the inbound webhook
 *   accepts forged messages — anyone who guesses the URL can write into a
 *   customer's timeline and buzz both phones.
 *
 * Free of imports so the test can simply import it. Takes an env-shaped object
 * rather than reading process.env, which is the only reason both of those cases
 * can be checked at all.
 */

export interface TwilioEnv {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_API_KEY_SID?: string;
  TWILIO_API_KEY_SECRET?: string;
  TWILIO_PHONE_NUMBER?: string;
}

export type CredentialKind = "api-key" | "auth-token" | "none";

export interface TwilioCredentials {
  /** Which credential the client will authenticate with. */
  kind: CredentialKind;
  /** Enough to send a message. */
  canSend: boolean;
  /**
   * Enough to validate an inbound webhook signature.
   *
   * Separate from `canSend` on purpose. Twilio signs webhooks with the account
   * auth token and never with an API key secret, so an app holding only an API
   * key sends perfectly and can verify nothing.
   */
  canVerify: boolean;
  /** What is missing, in words, for the error the operator actually reads. */
  missing: string[];
}

const trimmed = (value: string | undefined) => (value ?? "").trim();

export function readTwilioCredentials(env: TwilioEnv): TwilioCredentials {
  const accountSid = trimmed(env.TWILIO_ACCOUNT_SID);
  const authToken = trimmed(env.TWILIO_AUTH_TOKEN);
  const apiKeySid = trimmed(env.TWILIO_API_KEY_SID);
  const apiKeySecret = trimmed(env.TWILIO_API_KEY_SECRET);
  const fromNumber = trimmed(env.TWILIO_PHONE_NUMBER);

  // The prefixes are checked, not just the presence. Pasting an Account SID
  // into the API key slot is an easy mistake and would otherwise surface as a
  // generic 401 from Twilio hours later.
  const hasAccount = accountSid.startsWith("AC");
  const hasApiKey = apiKeySid.startsWith("SK") && apiKeySecret.length > 0;
  const hasAuthToken = authToken.length > 0;

  const missing: string[] = [];
  if (!hasAccount) {
    missing.push(
      accountSid
        ? "TWILIO_ACCOUNT_SID does not look like an Account SID (it should start with AC)"
        : "TWILIO_ACCOUNT_SID",
    );
  }
  if (!fromNumber) missing.push("TWILIO_PHONE_NUMBER");
  if (!hasApiKey && !hasAuthToken) {
    missing.push("TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET, or TWILIO_AUTH_TOKEN");
  } else if (apiKeySid && !apiKeySid.startsWith("SK")) {
    missing.push("TWILIO_API_KEY_SID does not look like an API key (it should start with SK)");
  }

  // The API key wins when both are present: it is the credential that can be
  // revoked on its own, so if somebody has gone to the trouble of setting one,
  // that is the one to use.
  const kind: CredentialKind = hasApiKey
    ? "api-key"
    : hasAuthToken
      ? "auth-token"
      : "none";

  return {
    kind,
    canSend: hasAccount && fromNumber.length > 0 && kind !== "none",
    canVerify: hasAuthToken,
    missing,
  };
}

/**
 * One sentence naming what to go and set. Used in the thrown error and in the
 * self-test on the Account screen, so both say the same thing.
 */
export function twilioSetupHint(credentials: TwilioCredentials): string {
  if (credentials.missing.length === 0) return "";
  return `Twilio is not fully configured. Missing: ${credentials.missing.join(", ")}.`;
}
