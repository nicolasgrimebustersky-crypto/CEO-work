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
