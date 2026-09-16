import type {
  CustomerStatus,
  JobStatus,
  PropertyType,
  QuoteStatus,
  ServiceType,
} from "./types";

/**
 * Pin colours are part of the spec, not a theme choice: orange=lead,
 * blue=not home, teal=come back, violet=interested, yellow=quoted,
 * green=customer, red=not interested, black=do not knock.
 * These hex values are duplicated as CSS custom properties in globals.css —
 * they are needed here as literals because map markers are drawn inline.
 *
 * Lead was grey until the owner pointed at the map they wanted: a street of
 * fresh doors should look warm and worth walking, not like the pins nobody
 * has got to. Grey now means nothing on the map, which is the point.
 */
export const STATUS_COLOR: Record<CustomerStatus, string> = {
  lead: "#f97316",
  not_home: "#2563eb",
  callback: "#14b8a6",
  interested: "#7c3aed",
  quoted: "#facc15",
  customer: "#22c55e",
  not_interested: "#ef4444",
  do_not_knock: "#0d0d0d",
};

export const STATUS_LABEL: Record<CustomerStatus, string> = {
  lead: "Lead",
  not_home: "Not home",
  callback: "Come back",
  interested: "Interested",
  quoted: "Quoted",
  customer: "Customer",
  not_interested: "Not interested",
  do_not_knock: "Do not knock",
};

/** One line each, for the picker and the legend. */
export const STATUS_HINT: Record<CustomerStatus, string> = {
  lead: "A door nobody has talked to yet",
  not_home: "Knocked, no answer — try again",
  callback: "They asked you to come back",
  interested: "Wants a price, not quoted yet",
  quoted: "An estimate is with them",
  customer: "They buy from you",
  not_interested: "They said no",
  do_not_knock: "Never knock here again",
};

/** Text colour to sit on top of the status colour and stay legible in sun. */
export const STATUS_INK: Record<CustomerStatus, string> = {
  lead: "#050607",
  not_home: "#ffffff",
  callback: "#050607",
  interested: "#ffffff",
  quoted: "#050607",
  customer: "#050607",
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

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  residential: "Residential",
  commercial: "Commercial",
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
