import "server-only";

import { readEmailConfig, type BuiltEmail } from "@/lib/emailNotice";

/**
 * Sending mail, via Resend's HTTP API.
 *
 * No SDK. The whole surface used here is one POST with a JSON body, and a
 * dependency that wraps one POST is a dependency that has to be kept current,
 * audited and built for the rest of its life. `fetch` is already in the
 * runtime.
 *
 * Like `notifyCrew`, this never throws. Every caller reaches it after the real
 * work has already committed — the approval is written, the timeline note is
 * filed, the push has gone — and failing a customer's signed approval because a
 * mail provider had a bad minute would be exactly backwards. The customer would
 * see an error and quite reasonably not sign again.
 */

export interface EmailResult {
  sent: boolean;
  /** Why not, when not. Logged, never shown to a customer. */
  problem: string;
}

const SKIPPED: EmailResult = { sent: false, problem: "" };

/** Resend rejects a request that hangs around; ten seconds is generous for it. */
const TIMEOUT_MS = 10_000;

export async function sendEmail(built: BuiltEmail): Promise<EmailResult> {
  // Named one by one rather than handing over process.env whole. Next replaces
  // these at build time by literal name, so a dynamic lookup is not guaranteed
  // to find them — and it keeps the reader's list of what this touches honest.
  const config = readEmailConfig({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    NOTIFY_EMAIL_TO: process.env.NOTIFY_EMAIL_TO,
    NOTIFY_EMAIL_FROM: process.env.NOTIFY_EMAIL_FROM,
  });
  // Not configured is not a failure. This feature is opt-in: an install with no
  // mail key should be quiet about it rather than logging an error per approval.
  if (!config.canSend) return SKIPPED;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: config.to,
        subject: built.subject,
        text: built.text,
        html: built.html,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Resend explains itself in the body — an unverified sending domain and a
      // revoked key are different problems and read differently. Worth keeping,
      // and safe to keep: the reply describes the request, never the key.
      const detail = await response.text().catch(() => "");
      const problem = `Resend refused the message (${response.status}). ${detail.slice(0, 300)}`.trim();
      console.error(problem);
      return { sent: false, problem };
    }

    return { sent: true, problem: "" };
  } catch (error) {
    const problem =
      error instanceof Error && error.name === "AbortError"
        ? `Resend did not answer within ${TIMEOUT_MS / 1000} seconds.`
        : `Could not reach Resend: ${error instanceof Error ? error.message : String(error)}`;
    console.error(problem);
    return { sent: false, problem };
  } finally {
    clearTimeout(timer);
  }
}
