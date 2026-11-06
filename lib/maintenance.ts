/**
 * Equipment maintenance: what is due, on what, and when.
 *
 * Each piece of equipment (a mower, the truck, a trimmer) carries its
 * service tasks — "Oil change every 50 hours", "Sharpen blades every 25
 * hours", "Grease the deck every 30 days". The equipment's name is the
 * same "for" name expenses use, so a repair expense logged against the
 * mower can say which tasks it was and restart their clocks.
 *
 * Nothing here is stored as "next due". What was done, and when, and the
 * hour meter or odometer readings, are an append-only log; what is due is
 * worked out from the log every time, so a late entry or a deleted one can
 * never leave a stale due date behind.
 *
 * Free of imports: the screens, the expense form and the daily cron all run
 * the same arithmetic, and the tests call it directly.
 */

export const METERS = ["none", "hours", "miles"] as const;
export type Meter = (typeof METERS)[number];

export const METER_UNIT: Record<Meter, string> = { none: "", hours: "hours", miles: "miles" };

export interface MaintenanceTask {
  id: string;
  what: string;
  /** Every so many days, or null. */
  everyDays: number | null;
  /** Every so many hours or miles on the equipment's meter, or null. */
  everyUnits: number | null;
}

export interface Equipment {
  id: string;
  name: string;
  meter: Meter;
  tasks: MaintenanceTask[];
}

export interface LogEntry {
  id: string;
  equipmentId: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** Tasks done. Empty for a plain meter reading. */
  taskIds: string[];
  /** Hour meter or odometer at the time, when known. */
  reading: number | null;
  /** Milliseconds, to order two entries on the same day. */
  at: number;
}

export type TaskState = "overdue" | "due_soon" | "ok" | "never_logged";

export interface TaskStatus {
  equipmentId: string;
  equipmentName: string;
  task: MaintenanceTask;
  state: TaskState;
  /** "YYYY-MM-DD" it falls due by the calendar, if it has a day interval. */
  dueOn: string | null;
  /** Negative once past. */
  daysLeft: number | null;
  /** Meter reading it falls due at, if it has an hours/miles interval. */
  dueAt: number | null;
  /** Negative once past. */
  unitsLeft: number | null;
  /** Last done, if ever. */
  lastDoneOn: string | null;
  /**
   * An hours/miles interval can't be worked out: no reading at the last
   * service, or no reading since. Log one to start that clock.
   */
  needsReading: boolean;
}

/** Due soon: within a quarter of the interval (two weeks at most), or a tenth of it on the meter. */
export const SOON_DAYS = 14;
export const SOON_FRACTION = 0.1;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(date: string): number {
  return Math.round(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + days));
  return d.toISOString().slice(0, 10);
}

const later = (a: LogEntry, b: LogEntry) => (a.date === b.date ? a.at - b.at : a.date < b.date ? -1 : 1);

/** The newest meter reading for a piece of equipment. */
export function latestReading(equipmentId: string, log: readonly LogEntry[]): { value: number; date: string } | null {
  let best: LogEntry | null = null;
  for (const e of log) {
    if (e.equipmentId !== equipmentId || e.reading == null || !Number.isFinite(e.reading)) continue;
    if (!best || later(best, e) < 0) best = e;
  }
  return best ? { value: best.reading as number, date: best.date } : null;
}

/** The newest time a task was done. */
export function lastDone(equipmentId: string, taskId: string, log: readonly LogEntry[]): LogEntry | null {
  let best: LogEntry | null = null;
  for (const e of log) {
    if (e.equipmentId !== equipmentId || !e.taskIds.includes(taskId) || !DATE.test(e.date)) continue;
    if (!best || later(best, e) < 0) best = e;
  }
  return best;
}

export function taskStatus(equipment: Equipment, task: MaintenanceTask, log: readonly LogEntry[], today: string): TaskStatus {
  const last = lastDone(equipment.id, task.id, log);
  const base: TaskStatus = {
    equipmentId: equipment.id,
    equipmentName: equipment.name,
    task,
    state: "never_logged",
    dueOn: null,
    daysLeft: null,
    dueAt: null,
    unitsLeft: null,
    lastDoneOn: last?.date ?? null,
    needsReading: false,
  };
  if (!last) return base;

  let overdue = false;
  let soon = false;

  if (task.everyDays && task.everyDays > 0) {
    base.dueOn = addDays(last.date, task.everyDays);
    base.daysLeft = dayNumber(base.dueOn) - dayNumber(today);
    if (base.daysLeft < 0) overdue = true;
    else if (base.daysLeft <= Math.min(SOON_DAYS, Math.ceil(task.everyDays * 0.25))) soon = true;
  }

  if (task.everyUnits && task.everyUnits > 0 && equipment.meter !== "none") {
    // The reading at the service, or failing that the newest one on or
    // before that day: someone logging "oil changed" rarely types the hours.
    const startReading =
      last.reading ??
      latestReading(
        equipment.id,
        log.filter((e) => e.date <= last.date),
      )?.value ??
      null;
    const now = latestReading(equipment.id, log);
    if (startReading == null || !now) {
      base.needsReading = true;
    } else {
      base.dueAt = Math.round((startReading + task.everyUnits) * 10) / 10;
      base.unitsLeft = Math.round((base.dueAt - now.value) * 10) / 10;
      if (base.unitsLeft <= 0) overdue = true;
      else if (base.unitsLeft <= task.everyUnits * SOON_FRACTION) soon = true;
    }
  }

  base.state = overdue ? "overdue" : soon ? "due_soon" : "ok";
  return base;
}

const ORDER: Record<TaskState, number> = { overdue: 0, due_soon: 1, never_logged: 2, ok: 3 };

/** Every task on every piece of equipment, most urgent first. */
export function allStatuses(equipment: readonly Equipment[], log: readonly LogEntry[], today: string): TaskStatus[] {
  const out: TaskStatus[] = [];
  for (const e of equipment) for (const t of e.tasks) out.push(taskStatus(e, t, log, today));
  return out.sort(
    (a, b) =>
      ORDER[a.state] - ORDER[b.state] ||
      (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) ||
      a.equipmentName.localeCompare(b.equipmentName),
  );
}

/** "Overdue by 6 hours", "Due in 3 days", "Due at 250 hours (12 to go)". */
export function dueText(s: TaskStatus, meter: Meter): string {
  if (s.state === "never_logged") return "Never logged — log the last time it was done";
  const unit = METER_UNIT[meter];
  const parts: string[] = [];
  if (s.daysLeft != null) {
    const d = s.daysLeft;
    parts.push(d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue` : d === 0 ? "due today" : `due in ${d} day${d === 1 ? "" : "s"}`);
  }
  if (s.unitsLeft != null) {
    const u = s.unitsLeft;
    parts.push(u <= 0 ? `${-u} ${unit} over` : `${u} ${unit} to go (at ${s.dueAt})`);
  }
  if (s.needsReading) parts.push(`log the ${unit === "miles" ? "odometer" : "hour meter"} to track the ${unit}`);
  const text = parts.join(" · ") || "No interval set";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The key a reminder is sent under. One push when a task comes due soon and
 * one when it goes overdue — not one a day — and a new pair after it is
 * done, because the key carries the date it was last done.
 */
export function noticeKey(s: TaskStatus): string | null {
  if (s.state !== "due_soon" && s.state !== "overdue") return null;
  return `${s.state}:${s.lastDoneOn ?? ""}`;
}

/** The equipment an expense's "for" name refers to, case and spacing aside. */
export function equipmentFor(forWhat: string, equipment: readonly Equipment[]): Equipment | null {
  const key = forWhat.trim().replace(/\s+/g, " ").toLowerCase();
  if (!key) return null;
  return equipment.find((e) => e.name.trim().replace(/\s+/g, " ").toLowerCase() === key) ?? null;
}

/** Common service intervals to start from; every one can be changed. */
export const PRESETS: Record<string, { meter: Meter; tasks: Omit<MaintenanceTask, "id">[] }> = {
  "Riding / zero-turn mower": {
    meter: "hours",
    tasks: [
      { what: "Oil and filter change", everyDays: null, everyUnits: 50 },
      { what: "Sharpen or replace blades", everyDays: null, everyUnits: 25 },
      { what: "Air filter", everyDays: null, everyUnits: 100 },
      { what: "Grease spindles and deck", everyDays: 30, everyUnits: null },
    ],
  },
  "Push mower": {
    meter: "none",
    tasks: [
      { what: "Sharpen blade", everyDays: 30, everyUnits: null },
      { what: "Oil change", everyDays: 90, everyUnits: null },
      { what: "Spark plug and air filter", everyDays: 365, everyUnits: null },
    ],
  },
  "Trimmer / blower": {
    meter: "none",
    tasks: [
      { what: "Air filter clean", everyDays: 30, everyUnits: null },
      { what: "Spark plug", everyDays: 365, everyUnits: null },
    ],
  },
  Truck: {
    meter: "miles",
    tasks: [
      { what: "Oil change", everyDays: 180, everyUnits: 5000 },
      { what: "Tire rotation", everyDays: null, everyUnits: 7500 },
    ],
  },
  Trailer: {
    meter: "none",
    tasks: [
      { what: "Grease bearings, check lights and tires", everyDays: 180, everyUnits: null },
    ],
  },
};

/** Validates stored equipment; bad tasks are dropped, not guessed at. */
export function asEquipment(id: string, raw: unknown): Equipment {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const meter = (METERS as readonly string[]).includes(String(r.meter)) ? (r.meter as Meter) : "none";
  const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const tasks: MaintenanceTask[] = [];
  if (Array.isArray(r.tasks)) {
    for (const t of r.tasks.slice(0, 20)) {
      if (!t || typeof t !== "object") continue;
      const x = t as Record<string, unknown>;
      if (typeof x.id !== "string" || typeof x.what !== "string" || !x.what.trim()) continue;
      const everyDays = pos(x.everyDays);
      const everyUnits = meter === "none" ? null : pos(x.everyUnits);
      if (!everyDays && !everyUnits) continue;
      tasks.push({ id: x.id, what: x.what.slice(0, 80), everyDays: everyDays ? Math.round(everyDays) : null, everyUnits });
    }
  }
  return { id, name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 60) : "Equipment", meter, tasks };
}
