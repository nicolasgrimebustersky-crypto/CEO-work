/**
 * The automations that live in code, described so they can be switched off.
 *
 * Two sequences already ran on a clock before this screen existed, and neither
 * had an off switch: turning one off meant editing `vercel.json` and
 * redeploying. That is the wrong shape for a decision the owner might want to
 * make on a Saturday morning because a customer complained — and it is the
 * wrong shape for the opposite reason too, because something that cannot be
 * turned off is something nobody is quite sure is on.
 *
 * So each one gets a row in the `automations` collection holding nothing but
 * the switch and the run history, and the cron reads that row before doing
 * anything. The sequence itself stays in code: `lib/leadNurture.ts` is tuned
 * for one situation and reasoned about line by line, and re-expressing it as a
 * generic rule would lose the parts that make it safe.
 *
 * Absent means on. That is deliberate and it is the only defensible default:
 * both of these were written to run, `vercel.json` has been asking for them
 * daily for months, and a missing document is an upgrade that has not been
 * through this screen yet — not a decision to stop. The screen says plainly
 * which rows have never been saved.
 *
 * Import-free, so the cron, the screen and the tests all read one list.
 */

export const BUILTIN_KEYS = ["lead_nurture", "money_reminders"] as const;
export type BuiltinKey = (typeof BUILTIN_KEYS)[number];

export interface BuiltinAutomation {
  key: BuiltinKey;
  /** Fixed document id, so a toggle can never create a second row. */
  docId: string;
  name: string;
  /** What it does, in the owner's words rather than the code's. */
  what: string;
  /** When it runs, as the cron schedule actually reads. */
  when: string;
  /** True when it can reach a customer. Drives the warning on the screen. */
  textsCustomers: boolean;
  /** The cron route that executes it, for the "what runs this" line. */
  route: string;
}

export const BUILTIN_AUTOMATIONS: readonly BuiltinAutomation[] = [
  {
    key: "lead_nurture",
    docId: "builtin_lead_nurture",
    name: "Chase unanswered estimates",
    what:
      "Texts a customer who was sent an estimate and has not accepted, declined or replied. " +
      "Three messages in the estimate's first month — a nudge on day 3, what the price covers " +
      "on day 10, and a last call on day 30 — then it stops for good. Any reply, acceptance or " +
      "decline ends it immediately, and it only picks up estimates sent in the last 45 days.",
    when: "Every day at 14:00 UTC",
    textsCustomers: true,
    route: "/api/cron/lead-nurture",
  },
  {
    key: "money_reminders",
    docId: "builtin_money_reminders",
    name: "Flag money that hasn't come in",
    what:
      "Notifies you in the app — it does not text anybody. An invoice gets called out once, " +
      "the morning it passes its due date, and on Mondays you get one line for everything " +
      "still outstanding.",
    when: "Every day at 13:00 UTC",
    textsCustomers: false,
    route: "/api/cron/money-reminders",
  },
] as const;

export function builtinByKey(key: string): BuiltinAutomation | null {
  return BUILTIN_AUTOMATIONS.find((builtin) => builtin.key === key) ?? null;
}

export function builtinByDocId(docId: string): BuiltinAutomation | null {
  return BUILTIN_AUTOMATIONS.find((builtin) => builtin.docId === docId) ?? null;
}

/** Where a built-in sits in the list. Unknown keys sort last. */
export function builtinOrder(key: string): number {
  const at = BUILTIN_AUTOMATIONS.findIndex((builtin) => builtin.key === key);
  return at === -1 ? BUILTIN_AUTOMATIONS.length : at;
}

/**
 * Whether a built-in may run, given the row that was found for it.
 *
 * `undefined` means no row exists — see the header. `enabled === false` is the
 * only thing that stops one, which keeps the rule short enough to be obvious
 * at the call site in the cron.
 */
export function builtinEnabled(row: { enabled: boolean } | null | undefined): boolean {
  if (row === null || row === undefined) return true;
  return row.enabled !== false;
}
