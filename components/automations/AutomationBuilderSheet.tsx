"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import {
  ACTION_LABEL,
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  actionLeavesTheBuilding,
  clampGuards,
  defaultConditions,
  defaultGuards,
  MAX_PER_RUN_CEILING,
  MAX_STALE_DAYS_CEILING,
  MAX_TOUCHES_CEILING,
  MIN_GAP_DAYS_FLOOR,
  SEND_HOUR_CEILING,
  SEND_HOUR_FLOOR,
  segmentsFor,
  TEMPLATE_FIELDS,
  TRIGGER_ANCHOR_LABEL,
  TRIGGER_LABEL,
  validateAutomation,
  type AutomationActionKind,
  type AutomationConditions,
  type AutomationGuards,
  type AutomationTrigger,
} from "@/lib/automations";
import {
  previewAutomation,
  type AutomationPreview,
} from "@/lib/automationsClient";
import {
  PIPELINE_LABEL,
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/lib/pipeline";
import { SERVICE_LABEL } from "@/lib/status";
import {
  PROPERTY_TYPES,
  SERVICE_TYPES,
  type PropertyType,
  type ServiceType,
} from "@/lib/types";

const INPUT =
  "tap-target w-full rounded-2xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

const NUMBER = `${INPUT} max-w-28`;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface BuilderValue {
  id?: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationConditions;
  action: {
    kind: AutomationActionKind;
    body: string;
    stage: PipelineStage | null;
  };
  guards: AutomationGuards;
}

export function emptyBuilderValue(): BuilderValue {
  return {
    name: "",
    trigger: "estimate_unanswered",
    conditions: defaultConditions(),
    action: { kind: "send_sms", body: "", stage: null },
    guards: defaultGuards(),
  };
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item)
    ? list.filter((entry) => entry !== item)
    : [...list, item];
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {hint ? (
        <p className="mt-0.5 text-sm font-semibold text-muted">{hint}</p>
      ) : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * The builder.
 *
 * Laid out as the sentence the automation makes — when, to whom, what, how
 * often — because that is the order somebody describes a follow-up out loud,
 * and an automation anybody can read out is one whose mistakes are visible.
 *
 * Two things are deliberately not optional. The preview button sits above
 * Save, not beside it, because the list of real names is the only thing that
 * reliably catches a wrong filter. And every number here is bounded by the
 * ceilings in lib/automations.ts, shown as the limit rather than silently
 * clamped afterwards, so the field never claims something the run will not do.
 */
export function AutomationBuilderSheet({
  open,
  initial,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: BuilderValue;
  saving: boolean;
  onClose: () => void;
  onSave: (value: BuilderValue) => void;
}) {
  const [value, setValue] = useState<BuilderValue>(initial);
  const [preview, setPreview] = useState<AutomationPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const patch = (next: Partial<BuilderValue>) => {
    setValue((current) => ({ ...current, ...next }));
    // A preview describes the draft it was run on. Keeping a stale one on
    // screen after an edit is how somebody arms a different automation from
    // the one he checked.
    setPreview(null);
  };

  const patchGuards = (next: Partial<AutomationGuards>) =>
    patch({ guards: clampGuards({ ...value.guards, ...next }) });

  const patchConditions = (next: Partial<AutomationConditions>) =>
    patch({ conditions: { ...value.conditions, ...next } });

  const problems = useMemo(() => validateAutomation(value), [value]);
  const texts = actionLeavesTheBuilding(value.action.kind);
  const segments = segmentsFor(value.action.body);

  const runPreview = async () => {
    setPreviewing(true);
    setPreviewError("");
    try {
      setPreview(await previewAutomation(value));
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : "Could not check.",
      );
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <Sheet
      open={open}
      title={value.id ? "Edit automation" : "Build an automation"}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" full onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            full
            onClick={() => onSave(value)}
            disabled={saving || problems.length > 0}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <label
        className="block text-sm font-bold text-muted"
        htmlFor="automation-name"
      >
        Name it
      </label>
      <input
        id="automation-name"
        value={value.name}
        onChange={(event) => patch({ name: event.target.value })}
        placeholder="Gutters before the leaves drop"
        className={`${INPUT} mt-1`}
      />

      <Section
        title="When it fires"
        hint="Pick what it watches, then how long to wait."
      >
        <div className="flex flex-wrap gap-2">
          {AUTOMATION_TRIGGERS.map((trigger) => (
            <Chip
              key={trigger}
              active={value.trigger === trigger}
              onClick={() => patch({ trigger })}
            >
              {TRIGGER_LABEL[trigger]}
            </Chip>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
          <input
            type="number"
            min={1}
            max={365}
            value={value.guards.afterDays}
            onChange={(event) =>
              patchGuards({ afterDays: Number(event.target.value) })
            }
            aria-label="Days to wait"
            className={NUMBER}
          />
          <span>days after {TRIGGER_ANCHOR_LABEL[value.trigger]}</span>
        </p>
        <p className="mt-2 text-sm font-semibold text-muted">
          Records older than{" "}
          <input
            type="number"
            min={value.guards.afterDays + 1}
            max={MAX_STALE_DAYS_CEILING}
            value={value.guards.staleAfterDays}
            onChange={(event) =>
              patchGuards({ staleAfterDays: Number(event.target.value) })
            }
            aria-label="Ignore anything older than this many days"
            className="w-20 rounded-xl border border-line bg-surface-2 px-2 py-1 text-ink"
          />{" "}
          days are left alone. This is the one that matters most: the day you
          switch an automation on, everything that has ever matched it matches
          at once.
        </p>
      </Section>

      <Section title="What it does">
        <div className="flex flex-wrap gap-2">
          {AUTOMATION_ACTIONS.map((kind) => (
            <Chip
              key={kind}
              active={value.action.kind === kind}
              onClick={() => patch({ action: { ...value.action, kind } })}
            >
              {ACTION_LABEL[kind]}
            </Chip>
          ))}
        </div>

        {value.action.kind === "move_stage" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {PIPELINE_STAGES.map((stage) => (
              <Chip
                key={stage}
                active={value.action.stage === stage}
                onClick={() => patch({ action: { ...value.action, stage } })}
              >
                {PIPELINE_LABEL[stage]}
              </Chip>
            ))}
          </div>
        ) : null}

        {value.action.kind === "send_sms" ||
        value.action.kind === "add_note" ? (
          <>
            <textarea
              value={value.action.body}
              onChange={(event) =>
                patch({ action: { ...value.action, body: event.target.value } })
              }
              rows={4}
              placeholder={
                texts
                  ? "Hi {first_name}, {business} here — want the gutters cleared before the leaves drop?"
                  : "What the note should say"
              }
              aria-label={texts ? "The text message" : "The note"}
              className={`${INPUT} mt-3`}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {TEMPLATE_FIELDS.map((field) => (
                <Chip
                  key={field.token}
                  onClick={() =>
                    patch({
                      action: {
                        ...value.action,
                        body: `${value.action.body}{${field.token}}`,
                      },
                    })
                  }
                >
                  {field.label}
                </Chip>
              ))}
            </div>
            {texts ? (
              <p className="mt-2 text-sm font-semibold text-muted">
                {segments <= 1
                  ? "One message"
                  : `${segments} messages per person`}{" "}
                — and &ldquo;Reply STOP to opt out.&rdquo; is added for you, so
                you never have to remember it.
              </p>
            ) : null}
          </>
        ) : null}
      </Section>

      <Section
        title="Who it reaches"
        hint="Leave a row empty to mean everybody the trigger found."
      >
        <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
          <span>Amount between</span>
          <input
            type="number"
            min={0}
            value={value.conditions.minAmount ?? ""}
            onChange={(event) =>
              patchConditions({
                minAmount:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
            aria-label="Smallest amount"
            placeholder="any"
            className={NUMBER}
          />
          <span>and</span>
          <input
            type="number"
            min={0}
            value={value.conditions.maxAmount ?? ""}
            onChange={(event) =>
              patchConditions({
                maxAmount:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
            aria-label="Largest amount"
            placeholder="any"
            className={NUMBER}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {SERVICE_TYPES.map((type) => (
            <Chip
              key={type}
              active={value.conditions.serviceTypes.includes(type)}
              onClick={() =>
                patchConditions({
                  serviceTypes: toggle<ServiceType>(
                    value.conditions.serviceTypes,
                    type,
                  ),
                })
              }
            >
              {SERVICE_LABEL[type]}
            </Chip>
          ))}
          {PROPERTY_TYPES.map((type) => (
            <Chip
              key={type}
              active={value.conditions.propertyTypes.includes(type)}
              onClick={() =>
                patchConditions({
                  propertyTypes: toggle<PropertyType>(
                    value.conditions.propertyTypes,
                    type,
                  ),
                })
              }
            >
              {type === "residential" ? "Houses" : "Businesses"}
            </Chip>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {PIPELINE_STAGES.map((stage) => (
            <Chip
              key={stage}
              active={value.conditions.stages.includes(stage)}
              onClick={() =>
                patchConditions({
                  stages: toggle<PipelineStage>(value.conditions.stages, stage),
                })
              }
            >
              {PIPELINE_LABEL[stage]}
            </Chip>
          ))}
        </div>

        <input
          value={value.conditions.addressContains.join(", ")}
          onChange={(event) =>
            patchConditions({
              addressContains: event.target.value
                .split(",")
                .map((text) => text.trim())
                .filter(Boolean),
            })
          }
          placeholder="Address contains — e.g. Crestwood, Pewee Valley"
          aria-label="Address contains"
          className={`${INPUT} mt-3`}
        />
      </Section>

      <Section title="How often, and when">
        <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
          <Chip
            active={value.guards.repeatEveryDays === null}
            onClick={() =>
              patchGuards({ repeatEveryDays: null, maxTouches: 1 })
            }
          >
            Once only
          </Chip>
          <Chip
            active={value.guards.repeatEveryDays !== null}
            onClick={() => patchGuards({ repeatEveryDays: 14, maxTouches: 2 })}
          >
            Repeat
          </Chip>
        </div>

        {value.guards.repeatEveryDays !== null ? (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
            <span>Every</span>
            <input
              type="number"
              min={MIN_GAP_DAYS_FLOOR}
              max={365}
              value={value.guards.repeatEveryDays}
              onChange={(event) =>
                patchGuards({ repeatEveryDays: Number(event.target.value) })
              }
              aria-label="Repeat every this many days"
              className={NUMBER}
            />
            <span>days, up to</span>
            <input
              type="number"
              min={1}
              max={MAX_TOUCHES_CEILING}
              value={value.guards.maxTouches}
              onChange={(event) =>
                patchGuards({ maxTouches: Number(event.target.value) })
              }
              aria-label="Most messages per person"
              className={NUMBER}
            />
            <span>times each (never more than {MAX_TOUCHES_CEILING})</span>
          </p>
        ) : null}

        <p className="mt-3 flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
          <span>Between</span>
          <input
            type="number"
            min={SEND_HOUR_FLOOR}
            max={SEND_HOUR_CEILING}
            value={value.guards.startHour}
            onChange={(event) =>
              patchGuards({ startHour: Number(event.target.value) })
            }
            aria-label="Earliest hour"
            className={NUMBER}
          />
          <span>and</span>
          <input
            type="number"
            min={SEND_HOUR_FLOOR + 1}
            max={SEND_HOUR_CEILING}
            value={value.guards.endHour}
            onChange={(event) =>
              patchGuards({ endHour: Number(event.target.value) })
            }
            aria-label="Latest hour"
            className={NUMBER}
          />
          <span>o&rsquo;clock</span>
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {DAY_NAMES.map((name, day) => (
            <Chip
              key={name}
              active={value.guards.daysOfWeek.includes(day)}
              onClick={() =>
                patchGuards({
                  daysOfWeek: toggle(value.guards.daysOfWeek, day),
                })
              }
            >
              {name}
            </Chip>
          ))}
        </div>
        <p className="mt-1 text-sm font-semibold text-muted">
          No days picked means any day.
        </p>

        <p className="mt-3 flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
          <span>At most</span>
          <input
            type="number"
            min={1}
            max={MAX_PER_RUN_CEILING}
            value={value.guards.maxPerRun}
            onChange={(event) =>
              patchGuards({ maxPerRun: Number(event.target.value) })
            }
            aria-label="Most per day"
            className={NUMBER}
          />
          <span>a day (never more than {MAX_PER_RUN_CEILING})</span>
        </p>
      </Section>

      <Section title="Check it before you arm it">
        <Button
          variant="secondary"
          full
          onClick={() => void runPreview()}
          disabled={previewing}
        >
          {previewing ? "Checking…" : "Who would this reach?"}
        </Button>

        {previewError ? (
          <p role="alert" className="mt-2 text-base font-semibold text-danger">
            {previewError}
          </p>
        ) : null}

        {preview?.demo ? (
          <p className="mt-2 text-sm font-semibold text-muted">
            Demo mode has no real customers, so there is nothing to check
            against here.
          </p>
        ) : null}

        {preview && !preview.demo ? (
          <div className="mt-3 rounded-2xl border border-line bg-surface-2 p-3">
            <p className="text-base font-bold text-ink">
              {preview.wouldSend === 0
                ? "Nobody, as things stand"
                : `${preview.wouldSend} ${preview.wouldSend === 1 ? "person" : "people"} match right now`}
            </p>
            {preview.wouldSend > preview.todayAtMost ? (
              <p className="mt-0.5 text-sm font-semibold text-muted">
                {preview.todayAtMost} would go today — the rest wait for the
                days after, because of the daily cap.
              </p>
            ) : null}
            <p className="mt-0.5 text-sm font-semibold text-muted">
              {preview.considered} records were checked.
            </p>

            {preview.sending.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {preview.sending.map((entry) => (
                  <li
                    key={entry.customerId}
                    className="rounded-xl bg-surface-1 p-2.5"
                  >
                    <p className="text-base font-bold text-ink">{entry.name}</p>
                    {texts ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-muted">
                        {entry.message}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {preview.skipped.length > 0 ? (
              <details className="mt-3">
                <summary className="tap-target cursor-pointer text-base font-bold text-ink">
                  Why the other {preview.skipped.length} are not getting it
                </summary>
                <ul className="mt-2 space-y-1">
                  {preview.skipped.map((entry) => (
                    <li
                      key={entry.customerId}
                      className="text-sm font-semibold text-muted"
                    >
                      <span className="text-ink">{entry.name}</span> —{" "}
                      {entry.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {preview.truncated ? (
              <p className="mt-2 text-sm font-semibold text-muted">
                Only the first 60 of each are listed.
              </p>
            ) : null}
          </div>
        ) : null}
      </Section>

      {problems.length > 0 ? (
        <ul className="mt-5 space-y-1" role="alert">
          {problems.map((problem) => (
            <li key={problem} className="text-base font-semibold text-danger">
              {problem}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-5 text-sm font-semibold text-muted">
        Saving does not switch it on. You arm it from the list, once you have
        read the preview.
      </p>
    </Sheet>
  );
}
