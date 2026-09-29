import "server-only";

import { canSendTo } from "@/lib/smsConsent";
import { getCustomer, optOutForPhone, type AdminCustomer } from "./customerNotes";
import { sendSms, type SendResult } from "./twilio";

/**
 * The one way to text a customer.
 *
 * `canSendTo` was added with the consent work and wired into `/api/sms/send`
 * and `/api/sms/blast` — the two paths a crew member triggers by hand. Three
 * others were missed, and they are the ones that matter most, because nobody
 * is watching when they fire:
 *
 *   the nightly quote follow-up cron, which texts every silent quote;
 *   the Meta lead webhook, which texts whoever filled in a Facebook form;
 *   the MCP `send_sms` tool, which any holder of an API key can call.
 *
 * Twilio blocks delivery after STOP at its own end, so no customer received
 * anything they had refused. What was wrong is that the business believed it
 * had sent them: the timeline said "sent", the follow-up counter advanced, and
 * the quote marched towards "declined" on the strength of three messages that
 * were never delivered.
 *
 * Patching three call sites would have left a fourth to be written later by
 * somebody who did not know the rule existed. So the check lives here instead,
 * and `tests/smsChokepoint.test.mjs` fails the build if a new file calls
 * `sendSms` directly without being on a short, deliberate allowlist.
 */

export interface CustomerSendResult extends SendResult {
  /**
   * True when consent stopped this, rather than Twilio or the network.
   *
   * Callers treat the two differently: a refusal is the system working and
   * should not be retried, where a Twilio error might be worth another go.
   */
  refused: boolean;
}

/**
 * Sends to a customer, or refuses and says why.
 *
 * Never throws. Every caller is a background job or a webhook where an
 * exception would abandon work that has already half-happened — a quote whose
 * counter was advanced, a lead whose record was written. They check `ok`.
 */
export async function sendSmsToCustomer(
  customer: AdminCustomer,
  body: string,
): Promise<CustomerSendResult> {
  const verdict = canSendTo(customer);
  if (!verdict.allowed) {
    return {
      ok: false,
      to: customer.phone,
      error: verdict.reason,
      refused: true,
    };
  }

  const result = await sendSms(customer.phone, body);
  return { ...result, refused: false };
}

/**
 * The same, for a caller that holds an id rather than a record.
 *
 * A missing customer is a refusal rather than a throw, for the reason above:
 * the alternative is a webhook 500 and Meta retrying a lead we already stored.
 */
export async function sendSmsToCustomerId(
  customerId: string,
  body: string,
): Promise<CustomerSendResult> {
  const customer = await getCustomer(customerId);
  if (!customer) {
    return {
      ok: false,
      to: "",
      error: "That customer no longer exists.",
      refused: true,
    };
  }
  return sendSmsToCustomer(customer, body);
}

/**
 * Sends to a bare number, for the one caller that does not have a record yet.
 *
 * The Meta lead webhook creates a new customer document per form submission
 * rather than matching an existing one, so the document it would hand to
 * `sendSmsToCustomer` is always seconds old and always carries no opt-out.
 * Checking it would be a check that cannot fail, which is worse than no check
 * at all — it reads as covered.
 *
 * So this asks the question the number can actually answer: has anybody on this
 * number ever told us to stop? A lead form arguably is fresh consent, and a
 * lawyer might say the text is permitted. It is still not sent, because Twilio
 * will refuse to deliver it, and a refusal recorded as "sent" is how the
 * business ends up believing it contacted somebody it did not.
 */
export async function sendSmsToPhone(
  phone: string,
  body: string,
): Promise<CustomerSendResult> {
  const number = (phone ?? "").trim();
  if (!number) {
    return { ok: false, to: "", error: "No phone number to send to.", refused: true };
  }

  const optOut = await optOutForPhone(number);
  if (optOut) {
    return {
      ok: false,
      to: number,
      error: `This number replied ${optOut.keyword || "STOP"} and has not opted back in. Call instead.`,
      refused: true,
    };
  }

  const result = await sendSms(number, body);
  return { ...result, refused: false };
}
