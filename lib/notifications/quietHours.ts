/**
 * When a notification is allowed to make a phone buzz.
 *
 * Every event in this app fires the moment it happens, which is right for a
 * payment landing at two in the afternoon and wrong for a Facebook lead form
 * submitted at three in the morning. Nobody is driving to a job at 3am, and a
 * notification that wakes you for something you cannot act on until daylight
 * teaches you to turn notifications off — which costs you the ones that
 * mattered.
 *
 * So quiet hours hold the *push* only. The Firestore record is still written
 * immediately, the bell still shows it, the badge still counts it. Nothing is
 * lost or delayed in the app itself; the only thing suppressed is the
 * interruption. That split is the whole design: the record is the record, push
 * is the interruption, and they are allowed to have different rules.
 *
 * Deliberately free of imports so it can be unit tested by running it, and so
 * the API routes can use the same file as the browser.
 */

/**
 * The business is in Oldham County, Kentucky. Both crew are in one timezone and
 * always will be — this is a two-person company that works one county.
 *
 * It has to be named explicitly because the decision is made on the server as
 * well as in the browser, and a Vercel function runs in UTC. "9pm" resolved
 * against UTC would silence the wrong five hours of the day.
 */
export const BUSINESS_TIMEZONE = "America/New_York";

/** Quiet from this hour... */
export const QUIET_FROM_HOUR = 21;
/** ...until this one. */
export const QUIET_UNTIL_HOUR = 7;

/** The local hour at a given instant, wherever the code happens to be running. */
export function hourInBusinessTimezone(at: Date, timeZone = BUSINESS_TIMEZONE): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(at);
  // hour12:false yields "24" for midnight in some engines rather than "0".
  return Number(formatted) % 24;
}

/**
 * True when a push sent right now would be an interruption rather than news.
 *
 * The window wraps midnight, so this is an OR rather than the usual range
 * check — the commonest way to get this wrong is to write `hour >= 21 && hour
 * < 7`, which is never true and silently disables the whole feature.
 */
export function isQuietHour(at: Date, timeZone = BUSINESS_TIMEZONE): boolean {
  const hour = hourInBusinessTimezone(at, timeZone);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

/**
 * Whether this person should be interrupted at this moment.
 *
 * Opting out is per person, not per device: it is a statement about when you
 * want to be disturbed, and it should not depend on which handset you happened
 * to grant permission on.
 */
export function shouldPushNow(
  quietHoursOn: boolean | null | undefined,
  at: Date = new Date(),
  timeZone = BUSINESS_TIMEZONE,
): boolean {
  // Undefined means the profile predates the setting. On by default: a person
  // who has never been asked would rather not be woken.
  if (quietHoursOn === false) return true;
  return !isQuietHour(at, timeZone);
}

/** For the Account screen, so the switch says what it actually does. */
export function quietHoursLabel(): string {
  const clock = (hour: number) => {
    const suffix = hour >= 12 ? "pm" : "am";
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelve}${suffix}`;
  };
  return `${clock(QUIET_FROM_HOUR)} to ${clock(QUIET_UNTIL_HOUR)}`;
}
