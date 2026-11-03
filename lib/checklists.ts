/**
 * Job checklists: the steps a visit is not finished without.
 *
 * Jobber, Housecall Pro and ServiceTitan all have them, for the same reason:
 * the call-back that costs a Saturday is nearly always a skipped small step —
 * the outlet that was not covered, the before photo nobody took, the gate left
 * open. A list on the job that each person ticks is cheaper than any of those.
 *
 * Every job starts with the usual list for its services and visit type, and
 * the crew can add, remove or tick anything. Stored on the job itself as a
 * small array, so it travels with the job and needs no rules of its own.
 *
 * Pure and import-free, so every rule is tested by calling it.
 */

export const MAX_ITEMS = 60;
export const MAX_ITEM_TEXT = 200;

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** Crew uid, and when, in epoch ms. Null until ticked. */
  doneBy: string | null;
  doneAt: number | null;
}

type Service = "pressure_washing" | "landscaping" | "snow_removal";
type Visit = "service" | "estimate" | "walkthrough" | "follow_up" | "touch_up";

/** The usual steps, per service. Written the way the crew would say them. */
const SERVICE_STEPS: Record<Service, string[]> = {
  pressure_washing: [
    "Walk the property with the customer",
    "Before photos",
    "Cover outlets, lights and plants",
    "Close windows and doors",
    "Pre-treat stains",
    "Rinse plants and beds after",
    "After photos",
  ],
  landscaping: [
    "Walk the property with the customer",
    "Before photos",
    "Mark sprinkler heads and lines",
    "Edge beds and walks",
    "Blow off hard surfaces",
    "Haul away debris",
    "After photos",
  ],
  snow_removal: [
    "Before photos",
    "Clear drive and walks",
    "Salt steps and walks",
    "Clear around mailbox and hydrant",
    "After photos",
  ],
};

/** A visit that is not paid work has its own short list. */
const VISIT_STEPS: Partial<Record<Visit, string[]>> = {
  estimate: [
    "Measure the areas",
    "Photos of every surface",
    "Ask when they want it done",
    "Ask how they heard about us",
    "Send the estimate before leaving",
  ],
  walkthrough: ["Walk the finished work with the customer", "Note anything they point out"],
  follow_up: ["Check the work held up", "Photos", "Ask for a review if they are happy"],
  touch_up: ["Before photos of the spot", "Fix it", "After photos", "Show the customer"],
};

/** Every service's steps, in order, once each. Closing steps go last. */
function mergeSteps(services: readonly string[]): string[] {
  const steps: string[] = [];
  const closing: string[] = [];
  for (const service of services) {
    for (const step of SERVICE_STEPS[service as Service] ?? []) {
      if (steps.includes(step) || closing.includes(step)) continue;
      if (step === "After photos" || step.startsWith("Haul away")) closing.push(step);
      else steps.push(step);
    }
  }
  // Photos are the very last thing: they record the job as it was left.
  closing.sort((a, b) => Number(a === "After photos") - Number(b === "After photos"));
  return [...steps, ...closing];
}

/** The steps a new job starts with. */
export function templateSteps(job: { serviceTypes: readonly string[]; visitType?: string }): string[] {
  const visit = (job.visitType ?? "service") as Visit;
  const forVisit = VISIT_STEPS[visit];
  if (forVisit) return [...forVisit];
  return mergeSteps(job.serviceTypes.length > 0 ? job.serviceTypes : ["pressure_washing"]);
}

let counter = 0;
/** Short, unique within a job. Not a secret, just a key. */
export function newItemId(now = Date.now()): string {
  counter = (counter + 1) % 1296;
  return `${now.toString(36)}${counter.toString(36).padStart(2, "0")}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0")}`;
}

export function fromSteps(steps: readonly string[], makeId: () => string = newItemId): ChecklistItem[] {
  return steps
    .slice(0, MAX_ITEMS)
    .map((text) => ({ id: makeId(), text: text.slice(0, MAX_ITEM_TEXT), done: false, doneBy: null, doneAt: null }));
}

/** Read defensively: a bad entry is dropped rather than breaking the job. */
export function asChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ChecklistItem[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id || seen.has(item.id)) continue;
    if (typeof item.text !== "string" || !item.text.trim()) continue;
    seen.add(item.id);
    const done = item.done === true;
    out.push({
      id: item.id,
      text: item.text.slice(0, MAX_ITEM_TEXT),
      done,
      doneBy: done && typeof item.doneBy === "string" ? item.doneBy : null,
      doneAt: done && typeof item.doneAt === "number" ? item.doneAt : null,
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export function toggleItem(
  list: readonly ChecklistItem[],
  id: string,
  uid: string,
  now: number,
): ChecklistItem[] {
  return list.map((item) =>
    item.id !== id
      ? item
      : item.done
        ? { ...item, done: false, doneBy: null, doneAt: null }
        : { ...item, done: true, doneBy: uid, doneAt: now },
  );
}

export function addItem(
  list: readonly ChecklistItem[],
  text: string,
  makeId: () => string = newItemId,
): ChecklistItem[] {
  const clean = text.trim().slice(0, MAX_ITEM_TEXT);
  if (!clean || list.length >= MAX_ITEMS) return [...list];
  return [...list, { id: makeId(), text: clean, done: false, doneBy: null, doneAt: null }];
}

export function removeItem(list: readonly ChecklistItem[], id: string): ChecklistItem[] {
  return list.filter((item) => item.id !== id);
}

export function progress(list: readonly ChecklistItem[]): { done: number; total: number } {
  return { done: list.filter((item) => item.done).length, total: list.length };
}

/** The open steps, for the "finish anyway?" warning when signing a job off. */
export function openSteps(list: readonly ChecklistItem[]): string[] {
  return list.filter((item) => !item.done).map((item) => item.text);
}
