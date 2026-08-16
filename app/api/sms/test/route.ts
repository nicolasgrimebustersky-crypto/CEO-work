import { errorResponse, requireCrew, ApiError } from "@/lib/server/auth";
import { adminDb } from "@/lib/server/admin";
import { preflight, withCors } from "@/lib/server/cors";
import { consumeRateLimit, SMS_TEST_LIMIT } from "@/lib/server/rateLimit";
import {
  isTwilioConfigured,
  canVerifyWebhooks,
  sendSms,
  toE164,
  twilioCredentials,
  twilioProblem,
} from "@/lib/server/twilio";

export const runtime = "nodejs";
/** Never cached — the GET reports live configuration and the POST spends money. */
export const dynamic = "force-dynamic";

/**
 * Proving the Twilio wiring works, without texting a customer to find out.
 *
 * The credentials only exist in the deployment's environment, so there is no
 * way to check them from a laptop — the first evidence that a value was pasted
 * into the wrong box has always been a customer saying they never got their
 * confirmation. This turns that into a button.
 *
 *   GET   what is configured, and whether your profile has a number to send to
 *   POST  actually send one text, to your own profile number and nowhere else
 *
 * The destination is read from `users/{uid}.phone` on the server. It is not
 * accepted from the request body on purpose: an endpoint that texts an
 * arbitrary number is an open SMS relay wearing a test label, and the crew
 * allowlist is not the right amount of protection for that.
 */

interface TwilioStatus {
  /** "api-key" | "auth-token" | "none" — never the credential itself. */
  kind: string;
  canSend: boolean;
  canVerify: boolean;
  /** Names of env vars still to set. Names only, never values. */
  missing: string[];
  problem: string;
  /** Whether the caller has a number on their own profile. */
  hasPhone: boolean;
}

/** Last four digits only, so the reply confirms the number without printing it. */
function maskedTail(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

async function myPhone(uid: string): Promise<string> {
  const snap = await adminDb().collection("users").doc(uid).get();
  const phone = snap.exists ? snap.data()?.phone : "";
  return typeof phone === "string" ? phone.trim() : "";
}

async function statusFor(uid: string): Promise<TwilioStatus> {
  return {
    kind: twilioCredentials.kind,
    canSend: isTwilioConfigured,
    canVerify: canVerifyWebhooks,
    missing: twilioCredentials.missing,
    problem: twilioProblem,
    hasPhone: (await myPhone(uid)).length > 0,
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request);
    return withCors(request, await statusFor(caller.uid));
  } catch (error) {
    return errorResponse(error, request);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request);
    const status = await statusFor(caller.uid);

    if (!isTwilioConfigured) {
      throw new ApiError(503, twilioProblem || "Twilio is not configured.");
    }

    const phone = await myPhone(caller.uid);
    if (!phone) {
      throw new ApiError(
        400,
        "Add your own phone number to your profile above first — the test only ever texts you.",
      );
    }
    if (!toE164(phone)) {
      throw new ApiError(
        400,
        `"${phone}" on your profile is not a phone number this can dial. Use a 10-digit US number.`,
      );
    }

    // Charged after the request is known-good so a missing profile number does
    // not eat an attempt, but before Twilio is touched, which is the point.
    await consumeRateLimit(caller.uid, "sms_test", SMS_TEST_LIMIT);

    const result = await sendSms(
      phone,
      "Grime Busters CRM: texting is working. Nothing was sent to a customer.",
    );

    // Deliberately not thrown. A failed send is the answer to the question the
    // button asks, and Twilio's own message ("unverified number", "A2P
    // campaign not approved") is the most useful thing on the screen — far
    // better than a bare 502 with the detail swallowed.
    return withCors(request, {
      ...status,
      sent: result.ok,
      sid: result.sid ?? null,
      tail: maskedTail(phone),
      error: result.error ?? null,
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}

/** Preflight for the iOS shell, which calls this cross-origin. */
export function OPTIONS(request: Request): Response {
  return preflight(request);
}
