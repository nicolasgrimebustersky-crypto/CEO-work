import type { CustomerStatus, JobStatus, QuoteStatus, ServiceType } from "./types";

/**
 * Pin colours are part of the spec, not a theme choice: gray=lead,
 * yellow=quoted, green=customer, red=not interested, black=do not knock.
 * These hex values are duplicated as CSS custom properties in globals.css —
 * they are needed here as literals because map markers are drawn inline.
 */
export const STATUS_COLOR: Record<CustomerStatus, string> = {
  lead: "#9aa7b4",
  quoted: "#facc15",
  customer: "#22c55e",
  not_interested: "#ef4444",
  do_not_knock: "#0d0d0d",
};

export const STATUS_LABEL: Record<CustomerStatus, string> = {
  lead: "Lead",
  quoted: "Quoted",
  customer: "Customer",
  not_interested: "Not interested",
  do_not_knock: "Do not knock",
};

/** Text colour to sit on top of the status colour and stay legible in sun. */
export const STATUS_INK: Record<CustomerStatus, string> = {
  lead: "#0b0f14",
  quoted: "#0b0f14",
  customer: "#0b0f14",
  not_interested: "#ffffff",
  do_not_knock: "#ffffff",
};

export const SERVICE_LABEL: Record<ServiceType, string> = {
  pressure_washing: "Pressure washing",
  landscaping: "Landscaping",
  snow_removal: "Snow removal",
};

export const SERVICE_SHORT_LABEL: Record<ServiceType, string> = {
  pressure_washing: "Wash",
  landscaping: "Lawn",
  snow_removal: "Snow",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
};

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  no_response: "No response",
};
