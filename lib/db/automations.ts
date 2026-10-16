import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  clampGuards,
  defaultConditions,
  type AutomationAction,
  type AutomationActionKind,
  type AutomationConditions,
  type AutomationGuards,
  type AutomationTrigger,
} from "@/lib/automations";
import { builtinOrder } from "@/lib/automationBuiltins";
import { readPause, type PauseState } from "@/lib/automationPause";
import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { asOrgId, DEFAULT_ORG_ID } from "@/lib/org";
import { isPipelineStage, type PipelineStage } from "@/lib/pipeline";
import { PROPERTY_TYPES, SERVICE_TYPES, type Author, type PropertyType, type ServiceType } from "@/lib/types";

const COLLECTION = COLLECTIONS.automations;

/**
 * Both kinds of automation live in one collection.
 *
 * A built-in wraps a sequence that lives in code — `lib/leadNurture.ts` and
 * the money reminders — and its document holds nothing but the switch and the
 * run history. A custom one holds the whole definition.
 *
 * Keeping them in one collection rather than splitting the switches into a
 * settings document is what makes the screen honest: everything that can text
 * a customer without being asked appears in one list, with one kind of toggle,
 * and nothing is hiding somewhere else. The alternative — built-ins read from
 * a config document, customs from a collection — is two places to look when
 * the question is "what is this app doing on its own?", and that question
 * deserves one answer.
 */
export const AUTOMATION_KINDS = ["builtin", "custom"] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

export interface StoredAutomation {
  id: string;
  /** Which business this record belongs to. See lib/org.ts. */
  orgId: string;
  kind: AutomationKind;
  /** Which hard-coded sequence this row switches. Empty on a custom one. */
  builtinKey: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationConditions;
  action: AutomationAction;
  guards: AutomationGuards;
  /** Written by the cron, so the screen can say when it last did anything. */
  lastRunAt: Timestamp | null;
  lastRunSummary: string;
  /** Lifetime sends, for the list. Not a guard — the guards count per person. */
  sentCount: number;
  /** A hold that ends by itself, or Forever. See lib/automationPause.ts. */
  pause: PauseState;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  updatedAt: Timestamp | null;
  updatedBy: string | null;
  updatedByName: string | null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Conditions, with every unrecognised value dropped rather than carried.
 *
 * A stage or service type that no longer exists would otherwise sit in the
 * filter list forever matching nothing, and an automation that matches nobody
 * looks exactly like one that is working and has nothing to do today. Dropping
 * it widens the automation back to what the trigger found, which is the
 * direction the builder's own "empty means any" default already points.
 */
export function asConditions(value: unknown): AutomationConditions {
  const data = (typeof value === "object" && value !== null ? value : {}) as DocumentData;
  return {
    minAmount: asNumberOrNull(data.minAmount),
    maxAmount: asNumberOrNull(data.maxAmount),
    serviceTypes: asStringArray(data.serviceTypes).filter((item): item is ServiceType =>
      SERVICE_TYPES.includes(item as ServiceType),
    ),
    stages: asStringArray(data.stages).filter((item): item is PipelineStage =>
      isPipelineStage(item),
    ),
    propertyTypes: asStringArray(data.propertyTypes).filter((item): item is PropertyType =>
      PROPERTY_TYPES.includes(item as PropertyType),
    ),
    addressContains: asStringArray(data.addressContains)
      .map((text) => text.trim())
      .filter((text) => text.length > 0),
  };
}

export function asAction(value: unknown): AutomationAction {
  const data = (typeof value === "object" && value !== null ? value : {}) as DocumentData;
  const kind = AUTOMATION_ACTIONS.includes(data.kind as AutomationActionKind)
    ? (data.kind as AutomationActionKind)
    : // An unreadable action falls back to the one that cannot reach a
      // customer. Anything else would mean a corrupt document gets the benefit
      // of the doubt and sends a text.
      "notify_crew";
  return {
    kind,
    body: typeof data.body === "string" ? data.body : "",
    stage: isPipelineStage(data.stage) ? data.stage : null,
  };
}

export function toAutomation(snap: QueryDocumentSnapshot<DocumentData>): StoredAutomation {
  const data = snap.data();
  return {
    id: snap.id,
    orgId: asOrgId(data.orgId),
    kind: AUTOMATION_KINDS.includes(data.kind as AutomationKind)
      ? (data.kind as AutomationKind)
      : "custom",
    builtinKey: typeof data.builtinKey === "string" ? data.builtinKey : "",
    name: typeof data.name === "string" ? data.name : "",
    // Absent reads as off. A document that cannot be understood must not be
    // the reason a text goes out.
    enabled: data.enabled === true,
    trigger: AUTOMATION_TRIGGERS.includes(data.trigger as AutomationTrigger)
      ? (data.trigger as AutomationTrigger)
      : "estimate_unanswered",
    conditions: asConditions(data.conditions),
    action: asAction(data.action),
    guards: clampGuards(data.guards),
    lastRunAt: data.lastRunAt instanceof Timestamp ? data.lastRunAt : null,
    lastRunSummary: typeof data.lastRunSummary === "string" ? data.lastRunSummary : "",
    sentCount: typeof data.sentCount === "number" ? data.sentCount : 0,
    pause: readPause(data),
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    updatedByName: typeof data.updatedByName === "string" ? data.updatedByName : null,
  };
}

/**
 * Built-ins first in their registry order, then newest custom ones.
 *
 * The built-ins are ordered by `builtinOrder` rather than by `createdAt`
 * because their rows are written by `setDoc(..., { merge: true })` and carry no
 * creation stamp of their own — sorting them by a timestamp the mapper had to
 * invent would reshuffle the top of the screen every time a switch was pressed.
 */
export function rankAutomations(automations: StoredAutomation[]): StoredAutomation[] {
  return [...automations].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "builtin" ? -1 : 1;
    if (a.kind === "builtin") return builtinOrder(a.builtinKey) - builtinOrder(b.builtinKey);
    return b.createdAt.toMillis() - a.createdAt.toMillis();
  });
}

export function subscribeAutomations(
  onChange: (automations: StoredAutomation[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    // Demo rows are stored as written, so the pause has to be read here the
    // way toAutomation reads it from Firestore.
    return demo.subscribe<StoredAutomation>(COLLECTION, (items) =>
      onChange(rankAutomations(items.map((item) => ({
          ...item,
          pause: readPause(item as unknown as { pausedUntil?: unknown; pausedForever?: unknown }),
        })))),
    );
  }
  return onSnapshot(
    query(collection(getDb(), COLLECTION)),
    (snap) => onChange(rankAutomations(snap.docs.map(toAutomation))),
    (error) => onError?.(error),
  );
}

export interface AutomationInput {
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationConditions;
  action: AutomationAction;
  guards: AutomationGuards;
}

/**
 * The fields a write may set, built from the input and nothing else.
 *
 * Spelled out rather than spread so a field added to `AutomationInput` has to
 * be added here on purpose. `enabled` is deliberately absent: arming an
 * automation is its own call, so saving an edit can never switch one on as a
 * side effect.
 */
function definitionPayload(input: AutomationInput): Record<string, unknown> {
  const guards = clampGuards(input.guards);
  return {
    name: input.name.trim(),
    trigger: input.trigger,
    conditions: {
      minAmount: input.conditions.minAmount,
      maxAmount: input.conditions.maxAmount,
      serviceTypes: [...input.conditions.serviceTypes],
      stages: [...input.conditions.stages],
      propertyTypes: [...input.conditions.propertyTypes],
      addressContains: input.conditions.addressContains
        .map((text) => text.trim())
        .filter(Boolean),
    },
    action: {
      kind: input.action.kind,
      body: input.action.body,
      stage: input.action.stage,
    },
    guards: { ...guards },
  };
}

export async function createAutomation(input: AutomationInput, author: Author): Promise<string> {
  const payload = {
    ...definitionPayload(input),
    kind: "custom" as const,
    builtinKey: "",
    // Always off at birth. An automation is armed from the list, after the
    // preview has shown who it would reach — never by the act of saving it.
    enabled: false,
    lastRunAt: null,
    lastRunSummary: "",
    sentCount: 0,
    orgId: DEFAULT_ORG_ID,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) return demo.add(COLLECTION, payload);
  // A generated id rather than addDoc, so the same path serves both.
  const ref = doc(collection(getDb(), COLLECTION));
  await setDoc(ref, payload);
  return ref.id;
}

export async function updateAutomation(
  id: string,
  input: AutomationInput,
  author: Author,
): Promise<void> {
  const payload = {
    ...definitionPayload(input),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) {
    demo.update(COLLECTION, id, payload);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, id), payload);
}

/**
 * Switches one on or off.
 *
 * Separate from `updateAutomation` because it is the one call that changes
 * whether the app acts on its own, and it should be readable as that in a
 * stack trace and greppable as that in this file.
 */
export async function setAutomationEnabled(
  id: string,
  enabled: boolean,
  author: Author,
): Promise<void> {
  const payload = {
    enabled,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) {
    demo.update(COLLECTION, id, payload);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, id), payload);
}

/**
 * Creates the switch document for a built-in sequence, off or on as asked.
 *
 * `setDoc` at a fixed id, so pressing the toggle twice cannot leave two rows
 * for the same sequence. `merge` keeps the run history the cron writes.
 */
export async function upsertBuiltinSwitch(
  docId: string,
  builtinKey: string,
  name: string,
  enabled: boolean,
  author: Author,
): Promise<void> {
  const payload = {
    kind: "builtin" as const,
    builtinKey,
    name,
    enabled,
    orgId: DEFAULT_ORG_ID,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) {
    const existing = demo.rows<StoredAutomation>(COLLECTION).find((row) => row.id === docId);
    if (existing) demo.update(COLLECTION, docId, payload);
    else demo.put(COLLECTION, docId, payload);
    return;
  }
  // `createdAt` is deliberately not in this write. With `merge: true` it would
  // be refreshed on every toggle, which is both untrue and — before the sort
  // above stopped depending on it — enough to reorder the screen mid-tap.
  // `createdBy` has to be here: the rules require the caller to stamp it, and
  // on a row that does not exist yet this call is a create.
  // `orgId` is repeated here although `payload` already carries it. Spelling
  // it out at the call site is what tests/orgIdOnCreate.test.mjs can actually
  // read: a field hidden behind a spread is a field that check cannot see, and
  // this is the exact field whose absence made "Convert to invoice" fail for
  // every estimate in #65. Local and redundant beats correct and invisible.
  await setDoc(
    doc(getDb(), COLLECTION, docId),
    {
      ...payload,
      orgId: DEFAULT_ORG_ID,
      createdBy: author.uid,
      createdByName: author.displayName,
    },
    { merge: true },
  );
}

/**
 * Pauses one, or lifts a pause (`state` = NOT_PAUSED).
 *
 * Never touches `enabled`: a pause is a hold on top of the switch, not a
 * second switch, so lifting it puts back exactly what was there before.
 *
 * `builtin` is passed for a built-in sequence that has no row yet. Its switch
 * has never been saved, so there is nothing to update; the write has to create
 * the full switch row, and `enabled: true` there records the state that was
 * already in force — a missing built-in row means on. Without it this would be
 * the half-row that reads as off (see recordRun in lib/server/automationStore).
 */
export async function setAutomationPause(
  id: string,
  state: PauseState,
  author: Author,
  builtin?: { builtinKey: string; name: string; exists: boolean },
): Promise<void> {
  const pauseFields = {
    pausedUntil:
      state.pausedUntilMs === null ? null : Timestamp.fromMillis(state.pausedUntilMs),
    pausedForever: state.pausedForever,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) {
    const existing = demo.rows<StoredAutomation>(COLLECTION).find((row) => row.id === id);
    if (existing) demo.update(COLLECTION, id, pauseFields);
    else if (builtin)
      demo.put(COLLECTION, id, {
        ...pauseFields,
        kind: "builtin",
        builtinKey: builtin.builtinKey,
        name: builtin.name,
        enabled: true,
        orgId: DEFAULT_ORG_ID,
      });
    return;
  }
  if (builtin && !builtin.exists) {
    // `orgId` and `createdBy` spelled out at the call site for the same reason
    // as upsertBuiltinSwitch: this is a create, and the rules check both.
    await setDoc(
      doc(getDb(), COLLECTION, id),
      {
        ...pauseFields,
        kind: "builtin" as const,
        builtinKey: builtin.builtinKey,
        name: builtin.name,
        enabled: true,
        orgId: DEFAULT_ORG_ID,
        createdBy: author.uid,
        createdByName: author.displayName,
      },
      { merge: true },
    );
    return;
  }
  await updateDoc(doc(getDb(), COLLECTION, id), pauseFields);
}

export async function deleteAutomation(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTION, id);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTION, id));
}

export { defaultConditions };
