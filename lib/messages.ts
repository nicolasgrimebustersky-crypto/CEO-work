import { format } from "date-fns";

/**
 * Every outbound SMS template lives here so the wording stays consistent
 * whether it was triggered from the calendar, the customer record, or the
 * nightly follow-up cron.
 */

const BUSINESS_NAME = "Grime Busters";

function whenText(date: Date): string {
  return format(date, "EEEE MMM d 'at' h:mm a");
}

export function jobConfirmationText(service: string, start: Date): string {
  return `${BUSINESS_NAME}: your ${service.toLowerCase()} is scheduled for ${whenText(start)}. Reply here if you need to change it.`;
}

export function jobRescheduledText(service: string, start: Date): string {
  return `${BUSINESS_NAME}: your ${service.toLowerCase()} has been rescheduled to ${whenText(start)}. Reply here if that doesn't work.`;
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
    return `${BUSINESS_NAME}: here's your estimate for ${service.toLowerCase()} — ${money}. Reply YES to book it, or with any questions.${tail}`;
  }
  if (balanceDue > 0 && balanceDue < total) {
    return `${BUSINESS_NAME}: thanks for the payment. ${`$${balanceDue.toFixed(2)}`} is still outstanding on your ${service.toLowerCase()} invoice.${tail}`;
  }
  return `${BUSINESS_NAME}: your invoice for ${service.toLowerCase()} is ${money}. Thanks for your business — reply here with any questions.${tail}`;
}

export function quoteFollowUpText(
  service: string,
  amount: number,
  attempt: number,
): string {
  const money = `$${Math.round(amount)}`;
  if (attempt === 1) {
    return `${BUSINESS_NAME}: just checking in on the ${money} ${service.toLowerCase()} quote we sent over. Happy to answer any questions.`;
  }
  if (attempt === 2) {
    return `${BUSINESS_NAME}: still interested in the ${money} ${service.toLowerCase()} quote? We have openings this week.`;
  }
  return `${BUSINESS_NAME}: last check on that ${money} ${service.toLowerCase()} quote. Reply any time if you'd like to book — otherwise we'll leave you be.`;
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
  return `${greetingFor(customerFirstName)}, your technicians from ${LEGAL_NAME} are currently en route to your scheduled appointment.`;
}

export function jobStartedText(technicianFirstName: string): string {
  return `Hey! This is ${technicianFirstName} from ${LEGAL_NAME}. I'm your technician for the day, if you have any questions feel free to reach out to ${OWNER_NAME} @ ${OWNER_PHONE}.`;
}

export function jobFinishedText(technicianFirstName: string): string {
  return `Hey! This is ${technicianFirstName} from ${LEGAL_NAME}. We just finished and are ready awaiting payment. We accept checks made out to ${LEGAL_NAME}, cash, Venmo ${PAYMENT_HANDLES.venmo}, Cash App ${PAYMENT_HANDLES.cashApp}. If you have none of these please reach out to ${OWNER_NAME} at ${OWNER_PHONE}.`;
}
