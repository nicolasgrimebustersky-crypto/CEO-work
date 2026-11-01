/**
 * What kind of visit a job is, alongside which service it is about.
 *
 * Until this existed every job was paid work: booking one moved the client to
 * "Job scheduled", finishing one asked whether the money was collected and
 * texted payment details, and the customer was told "your pressure washing is
 * scheduled". An estimate visit or a site walkthrough is none of those things,
 * and treating it as paid work put a client on the money-owed list for a visit
 * nobody was ever going to pay for.
 *
 * The service list (lib/types SERVICE_TYPES) stays the list of things that are
 * sold — it drives estimates, invoices, the price book and revenue by
 * service. A visit type is a separate question: what is this trip for.
 *
 * Absent on every job saved before this existed, which reads as "service" —
 * exactly what those jobs were.
 *
 * Pure and import-free so the rules can be tested by calling them.
 */

export const VISIT_TYPES = ["service", "estimate", "walkthrough", "follow_up", "touch_up"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const VISIT_LABEL: Record<VisitType, string> = {
  service: "Service job",
  estimate: "Estimate / consultation",
  walkthrough: "Site walkthrough",
  follow_up: "Follow-up visit",
  touch_up: "Touch-up / warranty",
};

/** Short, for a calendar block where space is tight. */
export const VISIT_SHORT_LABEL: Record<VisitType, string> = {
  service: "",
  estimate: "Estimate",
  walkthrough: "Walkthrough",
  follow_up: "Follow-up",
  touch_up: "Touch-up",
};

export function isVisitType(value: unknown): value is VisitType {
  return typeof value === "string" && (VISIT_TYPES as readonly string[]).includes(value);
}

/** A stored value, or "service" for anything missing or unrecognised. */
export function asVisitType(value: unknown): VisitType {
  return isVisitType(value) ? value : "service";
}

/**
 * Whether this visit is paid work.
 *
 * Only a service job is. Everything that follows from money — the price, the
 * "did you collect payment" question, the payment details in the finished
 * text, the move to "Job scheduled" / "Paid", the review request — applies to
 * billable visits and is skipped for the rest.
 */
export function isBillable(visit: VisitType | null | undefined): boolean {
  return asVisitType(visit) === "service";
}

/**
 * What the customer's text calls it, in lower case, to follow "your".
 *
 *   service     → "pressure washing"
 *   estimate    → "estimate visit for pressure washing"
 *   walkthrough → "site walkthrough for pressure washing"
 *   follow_up   → "follow-up visit"
 *   touch_up    → "touch-up visit for pressure washing"
 *
 * "Estimate visit", never "free estimate": whether an estimate is free is the
 * owner's call to make in his own words, not something a template promises.
 */
export function visitPhrase(visit: VisitType | null | undefined, serviceLabel: string): string {
  const service = serviceLabel.trim().toLowerCase();
  switch (asVisitType(visit)) {
    case "estimate":
      return service ? `estimate visit for ${service}` : "estimate visit";
    case "walkthrough":
      return service ? `site walkthrough for ${service}` : "site walkthrough";
    case "follow_up":
      return "follow-up visit";
    case "touch_up":
      return service ? `touch-up visit for ${service}` : "touch-up visit";
    default:
      return service;
  }
}

/** A job's title for the calendar and lists: "Estimate · Pressure washing", or just the service. */
export function visitTitle(visit: VisitType | null | undefined, serviceLabel: string): string {
  const short = VISIT_SHORT_LABEL[asVisitType(visit)];
  return short ? `${short} · ${serviceLabel}` : serviceLabel;
}
