import type { CustomerStatus } from "./types";

/**
 * The lead pipeline.
 *
 * A stage answers "what does this lead need from us next", which is a different
 * question from `customer.status` — that one answers "what colour is the pin on
 * the map". They overlap but are not the same: a customer at `paid` still shows
 * green on the map forever, and a `do_not_knock` pin has no live deal at all.
 * Keeping them separate means neither has to lie to satisfy the other, and
 * `syncStatusToStage` below stops them drifting apart.
 *
 * Ordered. `PIPELINE_STAGES.indexOf` is the sort order and the board's column
 * order, so add new stages in the position they belong in the process.
 */
export const PIPELINE_STAGES = [
  "new_lead",
  "estimate_sent",
  "estimate_accepted",
  "job_scheduled",
  "awaiting_payment",
  "paid",
  "lost",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Stages still in play. `paid` and `lost` are closed. */
export const OPEN_STAGES: PipelineStage[] = [
  "new_lead",
  "estimate_sent",
  "estimate_accepted",
  "job_scheduled",
  "awaiting_payment",
];

export const PIPELINE_LABEL: Record<PipelineStage, string> = {
  new_lead: "New lead",
  estimate_sent: "Estimate sent",
  estimate_accepted: "Accepted",
  job_scheduled: "Scheduled",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  lost: "Lost",
};

/** What the crew should do next. Shown on the board so a column is actionable. */
export const PIPELINE_HINT: Record<PipelineStage, string> = {
  new_lead: "Knock, call, or send a quote",
  estimate_sent: "Chase if there's no reply",
  estimate_accepted: "Get it on the calendar",
  job_scheduled: "Do the work",
  awaiting_payment: "Collect payment",
  paid: "Done — worth a follow-up next season",
  lost: "Closed. Revive if they come back",
};

/**
 * Board colours. Deliberately NOT the pin palette from lib/status.ts: reusing
 * green for both "customer" and "paid" would make two different meanings look
 * identical on two screens. This runs cool-to-warm as the deal progresses.
 */
export const PIPELINE_COLOR: Record<PipelineStage, string> = {
  new_lead: "#9aa7b4",
  estimate_sent: "#38bdf8",
  estimate_accepted: "#818cf8",
  job_scheduled: "#00d9ff",
  awaiting_payment: "#facc15",
  paid: "#22c55e",
  lost: "#6b7785",
};

export function isPipelineStage(value: unknown): value is PipelineStage {
  return PIPELINE_STAGES.includes(value as PipelineStage);
}

export function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

/** The stage that follows this one, or null at the end of the happy path. */
export function nextStage(stage: PipelineStage): PipelineStage | null {
  if (stage === "paid" || stage === "lost") return null;
  const next = OPEN_STAGES[OPEN_STAGES.indexOf(stage) + 1];
  return next ?? "paid";
}

/**
 * Only ever moves a lead forward.
 *
 * Automatic transitions fire off real events — a quote is sent, a job is
 * booked, an invoice is settled. Those events can arrive out of order: someone
 * schedules the work from a phone call and only records the quote afterwards.
 * Advancing on the later event would drag a scheduled job back to
 * "estimate sent", so the automation only ever ratchets forward and leaves
 * going backwards to a deliberate manual choice.
 */
export function advanceOnly(
  current: PipelineStage,
  candidate: PipelineStage,
): PipelineStage {
  // A closed deal stays closed until someone reopens it by hand.
  if (current === "paid" || current === "lost") return current;
  return stageIndex(candidate) > stageIndex(current) ? candidate : current;
}

/**
 * Keeps the map pin honest when a deal moves.
 *
 * Returns the status the pin should have, or null to leave it alone. The rules
 * are deliberately conservative — `do_not_knock` is never overwritten, because
 * that is a standing instruction from the household, not a deal state.
 */
export function syncStatusToStage(
  stage: PipelineStage,
  status: CustomerStatus,
): CustomerStatus | null {
  if (status === "do_not_knock") return null;

  switch (stage) {
    case "estimate_sent":
      return status === "lead" ? "quoted" : null;
    case "estimate_accepted":
    case "job_scheduled":
    case "awaiting_payment":
    case "paid":
      return status === "customer" ? null : "customer";
    case "lost":
      return status === "not_interested" ? null : "not_interested";
    default:
      return null;
  }
}

/** The mirror of the above: a pin marked dead closes the deal. */
export function stageForStatus(status: CustomerStatus): PipelineStage | null {
  if (status === "not_interested" || status === "do_not_knock") return "lost";
  return null;
}
