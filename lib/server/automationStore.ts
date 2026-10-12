import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  clampGuards,
  type AutomationActionKind,
  type AutomationConditions,
  type AutomationTrigger,
} from "@/lib/automations";
import { asOrgId } from "@/lib/org";
import { isPipelineStage, type PipelineStage } from "@/lib/pipeline";
import { adminDb } from "@/lib/server/admin";
import type { RunnableAutomation } from "@/lib/server/automationRun";
import { PROPERTY_TYPES, SERVICE_TYPES, type PropertyType, type ServiceType } from "@/lib/types";

/**
 * Reading the automations collection with the Admin SDK.
 *
 * A separate mapper from `lib/db/automations.ts` because that one is built on
 * the client SDK and cannot run on a server. The duplication is real and worth
 * naming: two mappers over one collection is how a field ends up handled in
 * one and dropped in the other, which is the exact bug class
 * tests/mappersKeepFields.test.mjs exists for. What keeps them honest here is
 * that this one is deliberately narrower — it builds only what the runner
 * needs to decide and act, and never what a screen renders — so a field added
 * for display cannot go missing here, because it was never read here.
 *
 * The Admin SDK bypasses security rules entirely, so every read below filters
 * orgId itself. A rule that says `belongsToMyOrg` protects nothing on this
 * side of the wire.
 */

const COLLECTION = "automations";

export interface AutomationRow {
  id: string;
  kind: "builtin" | "custom";
  builtinKey: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationConditions;
  action: { kind: AutomationActionKind; body: string; stage: PipelineStage | null };
  guards: ReturnType<typeof clampGuards>;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readConditions(value: unknown): AutomationConditions {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    minAmount: numberOrNull(data.minAmount),
    maxAmount: numberOrNull(data.maxAmount),
    serviceTypes: strings(data.serviceTypes).filter((item): item is ServiceType =>
      SERVICE_TYPES.includes(item as ServiceType),
    ),
    stages: strings(data.stages).filter((item): item is PipelineStage => isPipelineStage(item)),
    propertyTypes: strings(data.propertyTypes).filter((item): item is PropertyType =>
      PROPERTY_TYPES.includes(item as PropertyType),
    ),
    addressContains: strings(data.addressContains)
      .map((text) => text.trim())
      .filter((text) => text.length > 0),
  };
}

function readRow(doc: FirebaseFirestore.QueryDocumentSnapshot): AutomationRow {
  const data = doc.data();
  const actionData = (
    typeof data.action === "object" && data.action !== null ? data.action : {}
  ) as Record<string, unknown>;

  return {
    id: doc.id,
    kind: data.kind === "builtin" ? "builtin" : "custom",
    builtinKey: typeof data.builtinKey === "string" ? data.builtinKey : "",
    name: typeof data.name === "string" ? data.name : "",
    // Absent reads as off here, as it does in the client mapper. The built-in
    // default — absent row means on — is a question about a MISSING DOCUMENT,
    // answered by builtinEnabled, not about a missing field on one that exists.
    enabled: data.enabled === true,
    trigger: AUTOMATION_TRIGGERS.includes(data.trigger as AutomationTrigger)
      ? (data.trigger as AutomationTrigger)
      : "estimate_unanswered",
    conditions: readConditions(data.conditions),
    action: {
      kind: AUTOMATION_ACTIONS.includes(actionData.kind as AutomationActionKind)
        ? (actionData.kind as AutomationActionKind)
        : "notify_crew",
      body: typeof actionData.body === "string" ? actionData.body : "",
      stage: isPipelineStage(actionData.stage) ? actionData.stage : null,
    },
    guards: clampGuards(data.guards),
  };
}

export async function loadAutomationRows(orgId: string): Promise<AutomationRow[]> {
  const snap = await adminDb().collection(COLLECTION).get();
  const rows: AutomationRow[] = [];
  for (const doc of snap.docs) {
    if (asOrgId(doc.get("orgId")) !== orgId) continue;
    rows.push(readRow(doc));
  }
  return rows;
}

/** The switch row for a built-in, or undefined when it has never been saved. */
export function builtinRow(rows: AutomationRow[], docId: string): AutomationRow | undefined {
  return rows.find((row) => row.kind === "builtin" && row.id === docId);
}

/**
 * The custom automations that are armed and can actually do something.
 *
 * A `send_sms` with an empty body is filtered out here rather than refused at
 * the send: an automation whose message was cleared should do nothing quietly,
 * not fail once per matched customer and fill the run report with errors.
 */
export function armedCustomAutomations(rows: AutomationRow[]): RunnableAutomation[] {
  return rows
    .filter((row) => row.kind === "custom" && row.enabled)
    .filter((row) => {
      const needsBody = row.action.kind === "send_sms" || row.action.kind === "add_note";
      if (needsBody && row.action.body.trim() === "") return false;
      if (row.action.kind === "move_stage" && !row.action.stage) return false;
      return true;
    })
    .map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      trigger: row.trigger,
      conditions: row.conditions,
      action: row.action,
      guards: row.guards,
    }));
}

/**
 * Writes what a run did back onto the automation, for the screen.
 *
 * `update`, never `set`, and that is not a style choice. A merge-set creates
 * the document when it is missing, and the row it would create carries a
 * receipt and nothing else — no `kind`, no `enabled`. `readRow` reads a
 * missing `enabled` as off, so the first run of a built-in that had never been
 * saved would have written a row that switched that built-in off for every run
 * after it. The off switch would have been installed by the thing it switches.
 *
 * `update` throws on a missing document instead, which is the right outcome: a
 * built-in nobody has touched keeps no receipt until it is saved once, and the
 * screen shows it from the registry regardless.
 *
 * Swallows its own failure on purpose. The sends have already happened by the
 * time this is called, and failing to write the receipt must never be the
 * reason the run reports an error — that would read as "the texts did not go
 * out" when they did, which is the worst thing this report can say.
 */
export async function recordRun(
  automationId: string,
  summary: string,
  sent: number,
): Promise<void> {
  try {
    await adminDb().collection(COLLECTION).doc(automationId).update({
      lastRunAt: Timestamp.now(),
      lastRunSummary: summary,
      sentCount: FieldValue.increment(sent),
    });
  } catch {
    // Deliberately silent. See above.
  }
}
