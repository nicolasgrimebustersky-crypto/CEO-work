/**
 * Follow-ups: the "call Marta back Thursday" list.
 *
 * Every CRM worth paying for has one — Salesforce calls them tasks, HubSpot
 * calls them tasks, Jobber calls them requests to follow up — because the
 * thing that actually loses a sale is not a bad price, it is forgetting to
 * ring back. Until now the only place a reminder could live here was a note on
 * the customer, and a note does not come and find you.
 *
 * Due dates are DAYS, not moments. "Follow up Thursday" means any time on
 * Thursday; a task due at 9:00 that is still open at 9:05 is not late, and a
 * screen that turned it red would be crying wolf all morning. So a task is
 * overdue only once its day has passed, and the stored time (9:00 local) is
 * just a stable point inside the day.
 *
 * Pure and import-free, so every rule is tested by calling it.
 */

export const MAX_TITLE = 300;
export const MAX_NOTES = 2000;

/** The hour a due date is stored at. Inside the day, before the crew head out. */
export const DUE_HOUR = 9;

const DAY = 86_400_000;

/** The fields these rules read. `Task` in lib/types.ts satisfies it. */
export interface TaskLike {
  id: string;
  title: string;
  dueAt: { toMillis(): number } | null;
  doneAt: { toMillis(): number } | null;
  assignedTo: string | null;
  createdBy: string;
}

/* ------------------------------------------------------------------ days */

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `days` calendar days after `ms`, at DUE_HOUR. Calendar days, so DST cannot shift it. */
export function dayAt(ms: number, days = 0): Date {
  const d = new Date(ms);
  d.setHours(DUE_HOUR, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

/** Whole calendar days from today to the due day. Negative is late. */
export function daysUntil(dueMs: number, nowMs: number): number {
  // Rounded, because a day across a clock change is 23 or 25 hours long.
  return Math.round((startOfDay(dueMs) - startOfDay(nowMs)) / DAY);
}

/* --------------------------------------------------------------- presets */

export const DUE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "3days", label: "In 3 days" },
  { key: "nextweek", label: "Next week" },
  { key: "2weeks", label: "In 2 weeks" },
  { key: "month", label: "In a month" },
] as const;
export type DuePreset = (typeof DUE_PRESETS)[number]["key"];

/**
 * The date a preset means, from `nowMs`.
 *
 * "Next week" is next Monday rather than seven days out: said on a Friday it
 * means the start of next week, not next Friday, and on a Sunday it means
 * tomorrow.
 */
export function presetDue(preset: DuePreset, nowMs: number): Date {
  switch (preset) {
    case "today":
      return dayAt(nowMs, 0);
    case "tomorrow":
      return dayAt(nowMs, 1);
    case "3days":
      return dayAt(nowMs, 3);
    case "nextweek": {
      const weekday = new Date(nowMs).getDay();
      return dayAt(nowMs, ((8 - weekday) % 7) || 7);
    }
    case "2weeks":
      return dayAt(nowMs, 14);
    case "month": {
      const d = dayAt(nowMs, 0);
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      // Jan 31 + a month is the last day of February, not March 3rd.
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      return d;
    }
  }
}

/** A `<input type="date">` value, read as that day at DUE_HOUR local. */
export function dueFromInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), DUE_HOUR);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function inputFromDue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Pushed back by `days` — from today if it is already late.
 *
 * Snoozing a task that is a week overdue by one day must land on tomorrow,
 * not on six days ago, or the button would leave it exactly as red as before.
 */
export function snoozed(dueMs: number | null, days: number, nowMs: number): Date {
  const from = dueMs === null || dueMs < startOfDay(nowMs) ? nowMs : dueMs;
  return dayAt(from, days);
}

/* --------------------------------------------------------------- reading */

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

/** "Today", "Tomorrow", "Fri", "Nov 14", "Yesterday", "3 days late". */
export function dueLabel(dueMs: number, nowMs: number): string {
  const days = daysUntil(dueMs, nowMs);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < -1) return `${-days} days late`;
  if (days < 7) return new Date(dueMs).toLocaleDateString("en-US", { weekday: "short" });
  return new Date(dueMs).toLocaleDateString("en-US", SHORT_DATE);
}

export type DueTone = "late" | "today" | "soon" | "none";

export function dueTone(dueMs: number | null, nowMs: number): DueTone {
  if (dueMs === null) return "none";
  const days = daysUntil(dueMs, nowMs);
  if (days < 0) return "late";
  if (days === 0) return "today";
  return "soon";
}

export interface TaskGroups<T> {
  overdue: T[];
  today: T[];
  upcoming: T[];
  /** No date: still on the list, never nags. */
  someday: T[];
  /** Most recently finished first. */
  done: T[];
}

/**
 * The list, in the order you would work it: what is late, what is today, what
 * is coming. Inside each group, soonest first; ties keep the order given.
 */
export function groupTasks<T extends TaskLike>(tasks: readonly T[], nowMs: number): TaskGroups<T> {
  const groups: TaskGroups<T> = { overdue: [], today: [], upcoming: [], someday: [], done: [] };
  for (const task of tasks) {
    if (task.doneAt) groups.done.push(task);
    else if (!task.dueAt) groups.someday.push(task);
    else {
      const days = daysUntil(task.dueAt.toMillis(), nowMs);
      if (days < 0) groups.overdue.push(task);
      else if (days === 0) groups.today.push(task);
      else groups.upcoming.push(task);
    }
  }
  const byDue = (a: T, b: T) => (a.dueAt?.toMillis() ?? 0) - (b.dueAt?.toMillis() ?? 0);
  groups.overdue.sort(byDue);
  groups.today.sort(byDue);
  groups.upcoming.sort(byDue);
  groups.done.sort((a, b) => (b.doneAt?.toMillis() ?? 0) - (a.doneAt?.toMillis() ?? 0));
  return groups;
}

/** Open and due today or earlier: the number on the dashboard. */
export function dueNow<T extends TaskLike>(tasks: readonly T[], nowMs: number): T[] {
  return tasks.filter(
    (task) => !task.doneAt && task.dueAt !== null && daysUntil(task.dueAt.toMillis(), nowMs) <= 0,
  );
}

/** Whose list a task is on: its assignee, or whoever wrote it if nobody was named. */
export function ownerOf(task: Pick<TaskLike, "assignedTo" | "createdBy">): string {
  return task.assignedTo || task.createdBy;
}

export function isMine(task: Pick<TaskLike, "assignedTo" | "createdBy">, uid: string | null): boolean {
  return uid !== null && ownerOf(task) === uid;
}

/* ---------------------------------------------------------------- saving */

/** Why this cannot be saved, or null. */
export function taskProblem(input: { title: string; notes?: string }): string | null {
  const title = input.title.trim();
  if (!title) return "Say what needs doing.";
  if (title.length > MAX_TITLE) return `Keep it under ${MAX_TITLE} characters.`;
  if ((input.notes ?? "").length > MAX_NOTES) return `Notes are limited to ${MAX_NOTES} characters.`;
  return null;
}

/* ------------------------------------------------------------- reminders */

/**
 * The last millisecond of today in `timeZone`.
 *
 * The reminder cron runs on a server whose clock is UTC, where "today" ends
 * at 7 or 8 in the evening Kentucky time. Without this a follow-up due
 * tomorrow would be picked up a day early by an evening run.
 */
export function endOfDayIn(nowMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // The wall-clock time there, written as if it were UTC, minus the real
  // instant, is the zone's offset right now.
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = wall - Math.floor(nowMs / 1000) * 1000;
  const midnightAfter = Date.UTC(get("year"), get("month") - 1, get("day") + 1);
  return midnightAfter - offset - 1;
}

export interface ReminderTask extends TaskLike {
  remindedAt: { toMillis(): number } | null;
  customerName: string | null;
}

/**
 * Who to tell this morning, and about what.
 *
 * Open, due by the end of today, and not already reminded about — so each
 * task buzzes once, the morning it comes due (or the first morning after it is
 * created late). Grouped per person, so five follow-ups are one notification
 * and not five: a phone that buzzes five times before breakfast is a phone
 * whose notifications get switched off.
 */
export function remindersDue<T extends ReminderTask>(
  tasks: readonly T[],
  cutoffMs: number,
): Map<string, T[]> {
  const byOwner = new Map<string, T[]>();
  for (const task of tasks) {
    if (task.doneAt || task.remindedAt || !task.dueAt) continue;
    if (task.dueAt.toMillis() > cutoffMs) continue;
    const owner = ownerOf(task);
    if (!owner) continue;
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), task]);
  }
  for (const list of byOwner.values()) {
    list.sort((a, b) => (a.dueAt?.toMillis() ?? 0) - (b.dueAt?.toMillis() ?? 0));
  }
  return byOwner;
}

/** "Call Marta back · Marta Oakley", plus "and 2 more". */
export function reminderBody(tasks: readonly Pick<ReminderTask, "title" | "customerName">[]): string {
  if (tasks.length === 0) return "";
  const first = tasks[0];
  const head = first.customerName ? `${first.title} · ${first.customerName}` : first.title;
  return tasks.length === 1 ? head : `${head}, and ${tasks.length - 1} more`;
}
