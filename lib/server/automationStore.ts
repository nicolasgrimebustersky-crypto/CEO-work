import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  clampGuards,
  type AutomationActionKind,
  type AutomationConditions,
  type AutomationTrigger,
} from "@/lib/automations";
import { builtinEnabled } from "@/lib/automationBuiltins";
import { isPaused, readPause, type PauseState } from "@/lib/automationPause";
import { DEFAULT_ORG_ID, asOrgId } from "@/lib/org";
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
  pause: PauseState;
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
    pause: readPause(data),
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
/**
 * Whether a built-in should do its work this run: switched on (a missing row
 * counts as on) and not paused. Both crons ask this one question, so a pause
 * cannot be honoured by one sequence and ignored by the other.
 */
export function builtinLive(row: AutomationRow | undefined, nowMs: number = Date.now()): boolean {
  if (!builtinEnabled(row)) return false;
  return !isPaused(row?.pause, nowMs);
}

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
export function armedCustomAutomations(
  rows: AutomationRow[],
  nowMs: number = Date.now(),
): RunnableAutomation[] {
  return rows
    .filter((row) => row.kind === "custom" && row.enabled)
    // Paused is on but quiet: skipped this run, back by itself when it ends.
    .filter((row) => !isPaused(row.pause, nowMs))
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

/**
 * The same receipt for one of the two built-in sequences.
 *
 * `recordRun` cannot do this job, for the reason its own comment gives: it
 * uses `update`, which throws on a missing document, and a built-in nobody has
 * ever toggled HAS no document — absent means on. So until this existed the
 * built-ins never recorded a run at all, and the Automations screen said
 * "Never run … the CRON_SECRET deployment variable is missing" every morning
 * whether or not the cron had just run cleanly. The one screen meant to answer
 * "is this working?" could only ever answer no.
 *
 * Read and write in one transaction, so a toggle from the screen landing at
 * the same moment cannot be overwritten:
 *
 *   - The row exists: write the receipt and nothing else. Its `enabled` is
 *     somebody's decision and is left exactly as it is.
 *   - No row yet: create the full switch row, `enabled: true`. That is not a
 *     new decision — a missing row already means on (builtinEnabled), and this
 *     is only reached on a run the switch allowed. Creating it with every
 *     field the screen writes is what stops it reading as off: a row with a
 *     receipt and no `enabled` is the half-row `recordRun` warns about.
 *
 * Swallows its own failure, for the same reason recordRun does: the work has
 * already happened, and a missing receipt must never turn the run's report
 * into an error.
 */
export async function recordBuiltinRun(
  builtin: { key: string; docId: string; name: string },
  summary: string,
  sent: number,
): Promise<void> {
  try {
    const db = adminDb();
    const ref = db.collection(COLLECTION).doc(builtin.docId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const receipt = {
        lastRunAt: Timestamp.now(),
        lastRunSummary: summary,
        sentCount: FieldValue.increment(sent),
      };
      if (snap.exists) {
        tx.update(ref, receipt);
        return;
      }
      tx.create(ref, {
        kind: "builtin",
        builtinKey: builtin.key,
        name: builtin.name,
        enabled: true,
        orgId: DEFAULT_ORG_ID,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "system:cron",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "system:cron",
        updatedByName: "Automations",
        ...receipt,
      });
    });
  } catch {
    // Deliberately silent. See above.
  }
}
