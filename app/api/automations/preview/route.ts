import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  clampGuards,
  defaultConditions,
  type AutomationActionKind,
  type AutomationTrigger,
} from "@/lib/automations";
import { DEFAULT_ORG_ID } from "@/lib/org";
import { isPipelineStage, type PipelineStage } from "@/lib/pipeline";
import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import {
  evaluateAutomation,
  type RunnableAutomation,
} from "@/lib/server/automationRun";
import { loadAutomationRows } from "@/lib/server/automationStore";
import { preflight, withCors } from "@/lib/server/cors";
import {
  PROPERTY_TYPES,
  SERVICE_TYPES,
  type PropertyType,
  type ServiceType,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Reads the customers collection plus one more; well inside a normal request. */
export const maxDuration = 60;

/**
 * Who an automation would reach, and what it would say, before it is armed.
 *
 * This is the safety feature the rest of the feature is built around. An
 * automation the owner has not read is the one that goes wrong, and the only
 * reliable way to make somebody read a message is to show it to him next to
 * the list of people who are about to get it.
 *
 * It runs the same `evaluateAutomation` the cron runs, deliberately. A preview
 * computed by a second implementation would eventually disagree with the real
 * one, and the way that disagreement gets discovered is a customer receiving
 * something nobody previewed.
 *
 * Nothing is sent and nothing is written. The run's own caps are reported
 * rather than applied, so the answer to "how many today" is visible without
 * needing to know what `maxPerRun` is set to.
 */

/** How many names come back. Enough to judge a list, not enough to be a dump. */
const SAMPLE = 60;

interface PreviewBody {
  automationId?: unknown;
  draft?: unknown;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A draft from the builder, hardened into something runnable.
 *
 * Everything unrecognised is dropped rather than rejected. The builder posts
 * on every keystroke-settled edit, and a half-finished draft should preview as
 * "this would reach nobody yet" rather than as an error dialog.
 */
function draftToRunnable(raw: unknown): RunnableAutomation {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const conditions = (
    typeof data.conditions === "object" && data.conditions !== null
      ? data.conditions
      : {}
  ) as Record<string, unknown>;
  const action = (
    typeof data.action === "object" && data.action !== null ? data.action : {}
  ) as Record<string, unknown>;

  return {
    // A draft has no id, and the touch ledger is keyed on one. An empty id
    // would collide across drafts, so previews read the ledger of the
    // automation being edited when there is one and an unused key otherwise —
    // which is why a brand-new draft shows everybody as never-touched.
    id: typeof data.id === "string" && data.id ? data.id : "__draft__",
    name: typeof data.name === "string" ? data.name : "Draft",
    // Previewing is not arming. `decide` refuses a disabled automation
    // outright, so the preview asks it what it would do if it were on.
    enabled: true,
    trigger: AUTOMATION_TRIGGERS.includes(data.trigger as AutomationTrigger)
      ? (data.trigger as AutomationTrigger)
      : "estimate_unanswered",
    conditions: {
      ...defaultConditions(),
      minAmount: numberOrNull(conditions.minAmount),
      maxAmount: numberOrNull(conditions.maxAmount),
      serviceTypes: strings(conditions.serviceTypes).filter(
        (item): item is ServiceType =>
          SERVICE_TYPES.includes(item as ServiceType),
      ),
      stages: strings(conditions.stages).filter((item): item is PipelineStage =>
        isPipelineStage(item),
      ),
      propertyTypes: strings(conditions.propertyTypes).filter(
        (item): item is PropertyType =>
          PROPERTY_TYPES.includes(item as PropertyType),
      ),
      addressContains: strings(conditions.addressContains)
        .map((text) => text.trim())
        .filter(Boolean),
    },
    action: {
      kind: AUTOMATION_ACTIONS.includes(action.kind as AutomationActionKind)
        ? (action.kind as AutomationActionKind)
        : "notify_crew",
      body: typeof action.body === "string" ? action.body : "",
      stage: isPipelineStage(action.stage) ? action.stage : null,
    },
    guards: clampGuards(
      (typeof data.guards === "object" && data.guards !== null
        ? data.guards
        : {}) as Record<string, never>,
    ),
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireCrew(request);

    const payload = (await request.json().catch(() => ({}))) as PreviewBody;

    let automation: RunnableAutomation;
    if (typeof payload.automationId === "string" && payload.automationId) {
      const rows = await loadAutomationRows(DEFAULT_ORG_ID);
      const row = rows.find(
        (candidate) => candidate.id === payload.automationId,
      );
      if (!row) throw new ApiError(404, "That automation no longer exists.");
      if (row.kind === "builtin") {
        throw new ApiError(
          400,
          "The built-in sequences cannot be previewed here — their rules live in code.",
        );
      }
      automation = { ...row, enabled: true };
    } else if (payload.draft !== undefined) {
      automation = draftToRunnable(payload.draft);
    } else {
      throw new ApiError(400, "Nothing to preview.");
    }

    const { clock, candidates } = await evaluateAutomation(
      DEFAULT_ORG_ID,
      automation,
    );

    const sending = candidates.filter((candidate) => candidate.decision.send);
    const skipped = candidates.filter((candidate) => !candidate.decision.send);
    const guards = clampGuards(automation.guards);

    return withCors(request, {
      ok: true,
      considered: candidates.length,
      wouldSend: sending.length,
      // What today's run would actually do, which is the number that matters
      // and is not the same as wouldSend the moment a list is long.
      todayAtMost: Math.min(sending.length, guards.maxPerRun),
      perRunCap: guards.maxPerRun,
      localHour: clock.localHour,
      sending: sending.slice(0, SAMPLE).map((candidate) => ({
        customerId: candidate.customerId,
        name: candidate.customerName,
        phone: candidate.phone,
        message: candidate.message,
      })),
      skipped: skipped.slice(0, SAMPLE).map((candidate) => ({
        customerId: candidate.customerId,
        name: candidate.customerName,
        reason: candidate.decision.reason,
      })),
      truncated: sending.length > SAMPLE || skipped.length > SAMPLE,
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
