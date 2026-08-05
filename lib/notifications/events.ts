/**
 * Every event in the app that is worth telling the other person about.
 *
 * This file is the single source of truth for three things that used to be
 * scattered: what events exist, what each one is called, and where tapping one
 * takes you. Call sites supply the specifics — "Marta Oakley · $420" — and
 * nothing else, so the same event always reads the same way whether it was
 * raised from a phone, from the Twilio webhook or from a cron job.
 *
 * Events are grouped into five categories, and the categories are what the
 * Account screen exposes as switches. Twenty individual toggles is a settings
 * screen nobody reads; five is a decision somebody can actually make. The
 * grouping is by "do I want to be interrupted for this", not by which
 * collection the data lives in — a photo landing on a job is a customer-side
 * event, because that is how it feels when your phone buzzes.
 */

export const NOTIFICATION_CATEGORIES = [
  "jobs",
  "customers",
  "money",
  "messages",
  "leads",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  jobs: "Schedule",
  customers: "Customers",
  money: "Money",
  messages: "Messages",
  leads: "New leads",
};

export const CATEGORY_HINT: Record<NotificationCategory, string> = {
  jobs: "Jobs booked, moved, finished or cancelled.",
  customers: "New doors knocked, status changes, photos added to a job.",
  money: "Estimates and invoices sent, and payments landing.",
  messages: "A customer texts back.",
  leads: "Facebook and Instagram lead forms.",
};

/**
 * Where the notification points once it is tapped.
 *
 * Resolved against whichever ids the event carries — see `destinationFor`.
 * "customer" is the default because the customer record is the one screen that
 * has the whole story on it: the timeline, the jobs, the money, the photos.
 */
type Destination = "customer" | "document" | "schedule" | "pipeline";

interface EventDefinition {
  category: NotificationCategory;
  /** The headline. Fixed per event; the caller writes the line underneath. */
  title: string;
  destination: Destination;
}

export const NOTIFICATION_EVENTS = {
  /* ------------------------------------------------------------- schedule */
  job_created: { category: "jobs", title: "Job scheduled", destination: "schedule" },
  job_updated: { category: "jobs", title: "Job updated", destination: "schedule" },
  job_rescheduled: {
    category: "jobs",
    title: "Job rescheduled",
    destination: "schedule",
  },
  job_completed: { category: "jobs", title: "Job completed", destination: "customer" },
  job_cancelled: { category: "jobs", title: "Job cancelled", destination: "schedule" },

  /* ------------------------------------------------------------ customers */
  customer_added: {
    category: "customers",
    title: "New customer added",
    destination: "customer",
  },
  customer_status: {
    category: "customers",
    title: "Customer status changed",
    destination: "customer",
  },
  stage_changed: {
    category: "customers",
    title: "Pipeline stage moved",
    destination: "pipeline",
  },
  photo_added: { category: "customers", title: "Job photo added", destination: "customer" },

  /* ---------------------------------------------------------------- money */
  estimate_sent: { category: "money", title: "Estimate sent", destination: "document" },
  invoice_created: {
    category: "money",
    title: "Invoice ready to send",
    destination: "document",
  },
  invoice_sent: { category: "money", title: "Invoice sent", destination: "document" },
  estimate_accepted: {
    category: "money",
    title: "Estimate accepted",
    destination: "document",
  },
  payment_received: {
    category: "money",
    title: "Payment received",
    destination: "document",
  },
  followup_sent: {
    category: "money",
    title: "Quote follow-up sent",
    destination: "customer",
  },

  /* ------------------------------------------------------------- messages */
  sms_in: { category: "messages", title: "Customer replied", destination: "customer" },

  /* ---------------------------------------------------------------- leads */
  lead_new: { category: "leads", title: "New lead", destination: "customer" },
} as const satisfies Record<string, EventDefinition>;

export type NotificationType = keyof typeof NOTIFICATION_EVENTS;

export const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_EVENTS) as NotificationType[];

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && value in NOTIFICATION_EVENTS;
}

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return (
    typeof value === "string" &&
    (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
  );
}

export function categoryOf(type: NotificationType): NotificationCategory {
  return NOTIFICATION_EVENTS[type].category;
}

/**
 * Which screen a notification belongs to, and which record on it.
 *
 * The catalogue names a destination per event, but an event can be raised
 * without the id that destination needs — a payment recorded against a document
 * that has since been deleted, say — so each case degrades to the next most
 * useful screen rather than to a broken link.
 *
 * Returns a destination rather than a URL so this module stays free of imports:
 * the server routes need this logic and cannot pull in anything client-side,
 * and a module with no dependencies is one a unit test can simply run.
 * lib/notifications/link.ts turns the result into a path.
 */
export interface ResolvedDestination {
  screen: "customer" | "customers" | "document" | "invoices" | "schedule" | "pipeline";
  /** The record to open, when there is one. */
  id?: string;
}

export function destinationFor(item: {
  type: NotificationType;
  customerId?: string | null;
  documentId?: string | null;
}): ResolvedDestination {
  switch (NOTIFICATION_EVENTS[item.type].destination) {
    case "document":
      if (item.documentId) return { screen: "document", id: item.documentId };
      if (item.customerId) return { screen: "customer", id: item.customerId };
      return { screen: "invoices" };
    case "schedule":
      return { screen: "schedule" };
    case "pipeline":
      return { screen: "pipeline" };
    case "customer":
    default:
      return item.customerId
        ? { screen: "customer", id: item.customerId }
        : { screen: "customers" };
  }
}

export function titleOf(type: NotificationType): string {
  return NOTIFICATION_EVENTS[type].title;
}

/**
 * Muting is stored as a list of categories that are OFF rather than a list of
 * the ones that are on. Anything added to the catalogue later is therefore on
 * by default for everyone, which is the behaviour you want from a notification
 * you have not heard of yet — the alternative is a new event type that silently
 * reaches nobody because it was not in a list written months earlier.
 */
export function wantsCategory(
  muted: readonly string[] | null | undefined,
  category: NotificationCategory,
): boolean {
  return !(muted ?? []).includes(category);
}

export function wantsEvent(
  muted: readonly string[] | null | undefined,
  type: NotificationType,
): boolean {
  return wantsCategory(muted, categoryOf(type));
}

/**
 * Who should actually receive this event.
 *
 * Two filters, in order: never notify the person who did the thing — being told
 * about your own tap is noise, and in a two-person app that would double every
 * event — and then drop anyone who has muted the category.
 *
 * Filtering here, at the sending end, rather than when the list is rendered is
 * deliberate: a muted notification should never be written at all, or the badge
 * count would climb for something the person asked not to hear about.
 */
export function recipientsFor<T extends { uid: string; mutedNotifications?: string[] | null }>(
  crew: readonly T[],
  actorUid: string | null,
  type: NotificationType,
): string[] {
  return crew
    .filter((member) => member.uid !== actorUid)
    .filter((member) => wantsEvent(member.mutedNotifications, type))
    .map((member) => member.uid);
}
