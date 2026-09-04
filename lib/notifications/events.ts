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
  "chat",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  jobs: "Schedule",
  customers: "Customers",
  money: "Money",
  messages: "Messages",
  leads: "New leads",
  chat: "Team chat",
};

export const CATEGORY_HINT: Record<NotificationCategory, string> = {
  jobs: "Jobs booked, moved, finished or cancelled, and routes handed to you.",
  customers: "New doors knocked, status changes, photos added to a job.",
  money: "Estimates and invoices sent, and payments landing.",
  messages: "A customer texts back.",
  chat: "Somebody on the crew messages you in the app.",
  leads: "Facebook and Instagram lead forms.",
};

/**
 * Where the notification points once it is tapped.
 *
 * Resolved against whichever ids the event carries — see `destinationFor`.
 * "customer" is the default because the customer record is the one screen that
 * has the whole story on it: the timeline, the jobs, the money, the photos.
 */
type Destination =
  | "customer"
  | "document"
  | "invoices"
  | "knockRoutes"
  | "schedule"
  | "pipeline"
  | "chat";

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
  estimate_declined: {
    category: "money",
    title: "Estimate declined",
    destination: "document",
  },
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
  /**
   * A job signed off on site. Money rather than jobs: the thing the owner is
   * being told is whether the cash arrived, and somebody who has muted the
   * schedule still wants to hear about an unpaid job.
   */
  job_signed_off: {
    category: "money",
    title: "Job signed off",
    destination: "customer",
  },
  invoice_overdue: {
    category: "money",
    title: "Invoice past due",
    destination: "document",
  },
  money_summary: {
    category: "money",
    title: "Money still owed",
    destination: "invoices",
  },
  followup_sent: {
    category: "money",
    title: "Quote follow-up sent",
    destination: "customer",
  },

  /* ------------------------------------------------------------- messages */
  sms_in: { category: "messages", title: "Customer replied", destination: "customer" },

  /* ------------------------------------------------------------ team chat */
  chat_message: { category: "chat", title: "New message", destination: "chat" },

  /* --------------------------------------------------------------- routes */
  route_assigned: {
    category: "jobs",
    title: "Route assigned to you",
    destination: "knockRoutes",
  },

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
  screen:
    | "customer"
    | "customers"
    | "document"
    | "invoices"
    | "knockRoutes"
    | "schedule"
    | "pipeline"
    | "chat"
    | "chatThread";
  /** The record to open, when there is one. */
  id?: string;
}

export function destinationFor(item: {
  type: NotificationType;
  customerId?: string | null;
  documentId?: string | null;
  conversationId?: string | null;
}): ResolvedDestination {
  switch (NOTIFICATION_EVENTS[item.type].destination) {
    case "chat":
      // Straight into the thread when we know which one. Landing on the list
      // instead would make the notification one tap short of useful.
      return item.conversationId
        ? { screen: "chatThread", id: item.conversationId }
        : { screen: "chat" };
    case "document":
      if (item.documentId) return { screen: "document", id: item.documentId };
      if (item.customerId) return { screen: "customer", id: item.customerId };
      return { screen: "invoices" };
    case "invoices":
      return { screen: "invoices" };
    case "knockRoutes":
      return { screen: "knockRoutes" };
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

/**
 * Is this person *allowed* to hear about this category at all?
 *
 * Separate from muting, and the two are not interchangeable. Muting is a
 * preference the person sets for themselves; scope is a permission the admin
 * grants them. Somebody can be allowed a category and have muted it; they
 * cannot un-mute one they were never granted.
 *
 * Absent means everything. A profile written before scopes existed, or one
 * whose field failed to load, must not silently stop hearing about the job it
 * was just assigned — the failure mode of "no field, so nothing" is an
 * operator who quietly stops being told anything and does not know why.
 * Restricting is therefore always an explicit act.
 */
export function allowsCategory(
  scopes: readonly string[] | null | undefined,
  category: NotificationCategory,
): boolean {
  if (scopes == null) return true;
  return scopes.includes(category);
}

/** What this person actually receives: granted, and not muted. */
export function receivesCategory(
  scopes: readonly string[] | null | undefined,
  muted: readonly string[] | null | undefined,
  category: NotificationCategory,
): boolean {
  return allowsCategory(scopes, category) && wantsCategory(muted, category);
}

export function wantsEvent(
  muted: readonly string[] | null | undefined,
  type: NotificationType,
): boolean {
  return wantsCategory(muted, categoryOf(type));
}

export function receivesEvent(
  scopes: readonly string[] | null | undefined,
  muted: readonly string[] | null | undefined,
  type: NotificationType,
): boolean {
  return receivesCategory(scopes, muted, categoryOf(type));
}

/**
 * Who should actually receive this event.
 *
 * Three filters, in order: never notify the person who did the thing — being
 * told about your own tap is noise, and in a two-person app that would double
 * every event — then drop anyone the admin has not granted the category, and
 * then anyone who has muted it themselves.
 *
 * Filtering here, at the sending end, rather than when the list is rendered is
 * deliberate: a muted notification should never be written at all, or the badge
 * count would climb for something the person asked not to hear about.
 */
/**
 * The final audience, once an event has named specific people.
 *
 * Two rules, and the order matters: preferences first, then the address list.
 * Somebody who muted team chat must not be notified merely because they were
 * added to the thread, and the owner must not be notified about a job they
 * signed off themselves.
 *
 * Addressed events are the exception rather than the rule — team chat, and the
 * sign-off line the owner gets when a job is finished on site. Everything else
 * goes to the whole crew, so `toUids` absent means "everyone `recipientsFor`
 * allows" rather than "nobody".
 */
export function audienceFor<
  T extends {
    uid: string;
    mutedNotifications?: string[] | null;
    notificationScopes?: string[] | null;
  },
>(
  crew: readonly T[],
  actorUid: string | null,
  type: NotificationType,
  toUids?: readonly string[] | null,
): string[] {
  const allowed = recipientsFor(crew, actorUid, type);
  if (!toUids) return allowed;
  return allowed.filter((uid) => toUids.includes(uid));
}

export function recipientsFor<
  T extends {
    uid: string;
    mutedNotifications?: string[] | null;
    notificationScopes?: string[] | null;
  },
>(crew: readonly T[], actorUid: string | null, type: NotificationType): string[] {
  return crew
    .filter((member) => member.uid !== actorUid)
    .filter((member) =>
      receivesEvent(member.notificationScopes, member.mutedNotifications, type),
    )
    .map((member) => member.uid);
}
