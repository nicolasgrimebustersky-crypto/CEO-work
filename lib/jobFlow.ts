/**
 * The four taps a job goes through on site.
 *
 * A job in this business has a shape the calendar never captured: you drive to
 * it, you start it, you finish it, and then somebody decides whether the money
 * actually arrived. Three of those are worth a text to the customer — being
 * told a stranger is about to arrive at your house is the difference between a
 * service call and an intrusion — and the fourth is worth telling the owner.
 *
 * Everything here is a pure function of values the caller already has, and the
 * file imports nothing. That is what lets `tests/jobFlow.test.mjs` run it
 * directly under `node --experimental-strip-types`, which cannot resolve the
 * `@/` alias. The Firestore writes live in lib/db/jobs.ts and the screen in
 * components/schedule/JobStatusActions.tsx.
 */

/** The three steps that send the customer a text. `complete` does not. */
export const JOB_STEPS = ["en_route", "started", "finished"] as const;
export type JobStep = (typeof JOB_STEPS)[number];

export function isJobStep(value: unknown): value is JobStep {
  return typeof value === "string" && (JOB_STEPS as readonly string[]).includes(value);
}

/** The field each step stamps. Kept here so the writer and the screen agree. */
export const STEP_FIELD: Record<JobStep, string> = {
  en_route: "enRouteAt",
  started: "startedAt",
  finished: "finishedAt",
};

/** Who took the step. Paired with STEP_FIELD — one stamps when, one stamps who. */
export const STEP_BY_FIELD: Record<JobStep, string> = {
  en_route: "enRouteBy",
  started: "startedBy",
  finished: "finishedBy",
};

/**
 * The reason string attached to the outgoing text.
 *
 * It lands on the customer's timeline next to the message, so it has to survive
 * being read months later by somebody working out what happened on a job.
 */
export const STEP_SMS_REASON: Record<JobStep, string> = {
  en_route: "job_en_route",
  started: "job_started",
  finished: "job_finished",
};

/**
 * The name to put in a text signed by whoever tapped the button.
 *
 * First word only: "Noah Perkins" signs as "Noah", because that is how somebody
 * introduces themselves on a doorstep. Falls back to the business rather than
 * to an empty string — a text that opens "This is  from Grime Busters" reads
 * like a scam, which is the one thing an unknown number cannot afford to do.
 */
export function firstNameOf(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return first || "your technician";
}

/**
 * Whether a step has already been taken.
 *
 * Typed structurally rather than against Firestore's Timestamp so this file
 * keeps its no-imports property; anything with `toMillis` satisfies it, which
 * both the real Timestamp and the demo store's do.
 */
export interface Stamp {
  toMillis(): number;
}

export function stepTaken(stamp: Stamp | null | undefined): boolean {
  return stamp != null;
}

/**
 * Can this step be taken at all?
 *
 * Only two things actually block it. A cancelled job is not happening, so
 * telling the customer the crew is on the way would be worse than silence. And
 * a customer with no phone number cannot be texted — the button is disabled
 * rather than hidden so it is obvious that the missing phone is the problem
 * rather than the feature.
 *
 * Deliberately *not* blocked: taking the steps out of order. Real jobs go
 * sideways — the crew starts before anybody remembers to tap "en route", or
 * finishes one house and doubles back. A workflow that refuses the tap teaches
 * people to stop tapping.
 */
export function stepProblem(
  job: { status: string },
  customerPhone: string | null | undefined,
): string | null {
  if (job.status === "cancelled") return "This job is cancelled.";
  if (!(customerPhone ?? "").trim()) return "This customer has no phone number.";
  return null;
}

/**
 * The line the owner reads when a job is signed off.
 *
 * Money is passed in already formatted rather than formatted here: lib/format.ts
 * owns that, and a second implementation of it in this file would eventually
 * disagree with the invoices.
 */
export function signOffBody(details: {
  service: string;
  customer: string;
  money: string;
  collected: boolean;
}): string {
  const payment = details.collected ? "Payment collected" : "PAYMENT NOT COLLECTED";
  return `${details.service} · ${details.customer} · ${details.money} · ${payment}`;
}

/**
 * How far through the on-site sequence a job is, for the progress line.
 *
 * Counts stamps rather than assuming they arrive in order, because they do not.
 */
export function stepsTaken(job: {
  enRouteAt?: Stamp | null;
  startedAt?: Stamp | null;
  finishedAt?: Stamp | null;
}): number {
  return [job.enRouteAt, job.startedAt, job.finishedAt].filter(stepTaken).length;
}
