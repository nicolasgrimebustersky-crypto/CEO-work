import { format } from "date-fns";

/**
 * Every outbound SMS template lives here so the wording stays consistent
 * whether it was triggered from the calendar, the customer record, or the
 * nightly follow-up cron.
 */

const BUSINESS_NAME = "Grime Busters";

/**
 * The opt-out line, on every outbound template.
 *
 * Carriers expect it, and an A2P 10DLC campaign whose sample messages do not
 * carry it is one they flag. Twilio already honours STOP at its own end — a
 * customer who replies STOP stops receiving messages whether or not we ever
 * told them they could — so this is not what makes the opt-out work. What it
 * does is tell somebody it exists, which is the part a person standing in their
 * driveway with an unfamiliar number actually needs.
 *
 * Kept short on purpose. Every template here sits well inside one 160-character
 * SMS segment and this adds 23; a longer form ("Reply STOP to unsubscribe at
 * any time") would push the scheduling texts over into a second segment and
 * double the per-message cost for nothing.
 */
const OPT_OUT = " Reply STOP to opt out.";

function whenText(date: Date): string {
  return format(date, "EEEE MMM d 'at' h:mm a");
}

export function jobConfirmationText(service: string, start: Date): string {
  return `${BUSINESS_NAME}: your ${service.toLowerCase()} is scheduled for ${whenText(start)}. Reply here if you need to change it.${OPT_OUT}`;
}

export function jobRescheduledText(service: string, start: Date): string {
  return `${BUSINESS_NAME}: your ${service.toLowerCase()} has been rescheduled to ${whenText(start)}. Reply here if that doesn't work.${OPT_OUT}`;
}

/**
 * The text that goes out with an estimate or an invoice.
 *
 * Cents are included here where the follow-up template rounds: this number is
 * the one the customer is being asked to agree to or pay, so it has to match
 * the document exactly.
 */
export function documentText(
  kind: "estimate" | "invoice",
  service: string,
  total: number,
  balanceDue: number,
  link?: string | null,
): string {
  const money = `$${total.toFixed(2)}`;
  // On its own line and last, so it stays a tappable link in every messages
  // app. Punctuation immediately after a URL is the usual way one arrives
  // broken — a trailing full stop gets swallowed into the href by some
  // clients and the customer taps through to a 404.
  const tail = link ? `\n\n${link}` : "";

  if (kind === "estimate") {
    return `${BUSINESS_NAME}: here's your estimate for ${service.toLowerCase()} — ${money}. Reply YES to book it, or with any questions.${OPT_OUT}${tail}`;
  }
  if (balanceDue > 0 && balanceDue < total) {
    return `${BUSINESS_NAME}: thanks for the payment. ${`$${balanceDue.toFixed(2)}`} is still outstanding on your ${service.toLowerCase()} invoice.${OPT_OUT}${tail}`;
  }
  return `${BUSINESS_NAME}: your invoice for ${service.toLowerCase()} is ${money}. Thanks for your business — reply here with any questions.${OPT_OUT}${tail}`;
}

export function quoteFollowUpText(
  service: string,
  amount: number,
  attempt: number,
): string {
  const money = `$${Math.round(amount)}`;
  if (attempt === 1) {
    return `${BUSINESS_NAME}: just checking in on the ${money} ${service.toLowerCase()} quote we sent over. Happy to answer any questions.${OPT_OUT}`;
  }
  if (attempt === 2) {
    return `${BUSINESS_NAME}: still interested in the ${money} ${service.toLowerCase()} quote? We have openings this week.${OPT_OUT}`;
  }
  return `${BUSINESS_NAME}: last check on that ${money} ${service.toLowerCase()} quote. Reply any time if you'd like to book — otherwise we'll leave you be.${OPT_OUT}`;
}

/* ------------------------------------------------------------ on the job */

/**
 * The four texts the crew sends from a driveway, in the order they happen:
 * pulling up, starting, finishing, and then the sign-off that is not a text at
 * all — see lib/jobFlow.ts.
 *
 * These carry the legal name rather than the short one. A customer writing a
 * cheque needs the name their bank will accept, and somebody deciding whether
 * an unknown number is a scam needs the name on the invoice they were sent.
 */
const LEGAL_NAME = "Grime Busters KY LLC";

/** Who a customer is pointed at when the person on site cannot help. */
const OWNER_NAME = "Nicolas";
const OWNER_PHONE = "502-599-6855";

/**
 * How to pay. Deliberately not secrets and deliberately not in the environment:
 * these are handed to every customer at the end of every job, and a payment
 * handle that differs between the text and the invoice is a support call.
 */
export const PAYMENT_HANDLES = {
  venmo: "@NicolasTimmons",
  cashApp: "$GrimeBustersKYLLC",
} as const;

/**
 * "Hi Marta" where we know the name, "Hi there" where we do not.
 *
 * A pin dropped at a door often has an address and no name yet. "Hi ," reads as
 * a broken mail merge, which is exactly what a stranger's text has to avoid.
 */
export function greetingFor(firstName: string | null | undefined): string {
  const name = (firstName ?? "").trim();
  return name ? `Hi ${name}` : "Hi there";
}

export function enRouteText(customerFirstName: string | null | undefined): string {
  return `${greetingFor(customerFirstName)}, your technicians from ${LEGAL_NAME} are currently en route to your scheduled appointment.${OPT_OUT}`;
}

export function jobStartedText(technicianFirstName: string): string {
  return `Hey! This is ${technicianFirstName} from ${LEGAL_NAME}. I'm your technician for the day, if you have any questions feel free to reach out to ${OWNER_NAME} @ ${OWNER_PHONE}.${OPT_OUT}`;
}

export function jobFinishedText(technicianFirstName: string): string {
  return `Hey! This is ${technicianFirstName} from ${LEGAL_NAME}. We just finished and are ready awaiting payment. We accept checks made out to ${LEGAL_NAME}, cash, Venmo ${PAYMENT_HANDLES.venmo}, Cash App ${PAYMENT_HANDLES.cashApp}. If you have none of these please reach out to ${OWNER_NAME} at ${OWNER_PHONE}.${OPT_OUT}`;
}

/**
 * The thank-you that goes out when the money is in hand.
 *
 * Sent from the sign-off on site, and only when the crew member answers yes to
 * "did you get paid" — so it is a receipt first and an ask second. That order
 * is deliberate in the wording too: it confirms something the customer cares
 * about before asking them for anything, which is the difference between a
 * courtesy and a solicitation.
 *
 * The link goes last and on its own line, for the same reason `documentText`
 * does it: punctuation immediately after a URL gets swallowed into the href by
 * some messaging apps and the customer taps through to a 404.
 *
 * Returns "" when no review link is configured. A thank-you that asks for a
 * review and then offers nowhere to leave one is worse than sending nothing,
 * and the caller treats "" as "don't send".
 */
export function reviewRequestText(
  customerFirstName: string | null | undefined,
  reviewUrl: string,
): string {
  const url = (reviewUrl ?? "").trim();
  if (!url) return "";
  return `${greetingFor(customerFirstName)}, thanks — ${BUSINESS_NAME} has received your payment and the job is all wrapped up. If we did right by you, a quick Google review helps a small local business more than you'd think.${OPT_OUT}\n\n${url}`;
}
