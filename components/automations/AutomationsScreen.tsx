"use client";

import { useEffect, useMemo, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import {
  AutomationBuilderSheet,
  emptyBuilderValue,
  type BuilderValue,
} from "@/components/automations/AutomationBuilderSheet";
import { BUILTIN_AUTOMATIONS, builtinEnabled } from "@/lib/automationBuiltins";
import { describeAutomation } from "@/lib/automations";
import {
  createAutomation,
  deleteAutomation,
  setAutomationEnabled,
  subscribeAutomations,
  updateAutomation,
  upsertBuiltinSwitch,
  type StoredAutomation,
} from "@/lib/db/automations";
import { formatRelative } from "@/lib/format";

/**
 * What the app does on its own.
 *
 * The screen exists because of a gap that was not a bug in any one file: two
 * sequences ran on a nightly clock, neither could be switched off without a
 * redeploy, and nothing in the app said they existed. A business owner should
 * not have to read `vercel.json` to find out what is texting his customers.
 *
 * So everything that can act without being asked is in one list, built-in and
 * hand-built alike, each with the same switch. The order is deliberate: the
 * ones that came with the app first, because those are the ones somebody did
 * not choose and most needs to be told about.
 */
function Switch({
  on,
  label,
  busy,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  busy: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy || disabled}
      onClick={() => onChange(!on)}
      className={`tap-target relative flex w-16 shrink-0 items-center rounded-full p-1 transition ${
        on ? "bg-accent" : "bg-surface-3"
      } ${busy || disabled ? "opacity-60" : ""}`}
    >
      <span
        className={`size-8 rounded-full bg-white transition-transform ${
          on ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-line bg-surface-2 p-3.5">
      {children}
    </li>
  );
}

export function AutomationsScreen() {
  const { author, isAdmin } = useTeam();
  const [rows, setRows] = useState<StoredAutomation[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [editing, setEditing] = useState<BuilderValue | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return subscribeAutomations(
      (next) => {
        setRows(next);
        setError("");
      },
      (problem) => setError(problem.message),
    );
  }, []);

  const byId = useMemo(
    () => new Map((rows ?? []).map((row) => [row.id, row])),
    [rows],
  );
  const custom = useMemo(
    () => (rows ?? []).filter((row) => row.kind === "custom"),
    [rows],
  );

  const toggleBuiltin = async (
    docId: string,
    key: string,
    name: string,
    next: boolean,
  ) => {
    if (!author) return;
    setBusyId(docId);
    try {
      await upsertBuiltinSwitch(docId, key, name, next, author);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Could not change that.",
      );
    } finally {
      setBusyId("");
    }
  };

  const toggleCustom = async (row: StoredAutomation, next: boolean) => {
    if (!author) return;
    setBusyId(row.id);
    try {
      await setAutomationEnabled(row.id, next, author);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Could not change that.",
      );
    } finally {
      setBusyId("");
    }
  };

  const save = async (value: BuilderValue) => {
    if (!author) return;
    setSaving(true);
    try {
      const input = {
        name: value.name,
        trigger: value.trigger,
        conditions: value.conditions,
        action: value.action,
        guards: value.guards,
      };
      if (value.id) await updateAutomation(value.id, input, author);
      else await createAutomation(input, author);
      setEditing(null);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Could not save that.",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: StoredAutomation) => {
    if (!window.confirm(`Delete "${row.name}"? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      await deleteAutomation(row.id);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Could not delete that.",
      );
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Automations"
        subtitle="What the app does without being asked"
      >
        {isAdmin ? (
          <div className="mt-3">
            <Button full onClick={() => setEditing(emptyBuilderValue())}>
              Build an automation
            </Button>
          </div>
        ) : null}
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl">
          {error ? (
            <p
              role="alert"
              className="rounded-2xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
            >
              {error}
            </p>
          ) : null}

          {rows === null ? (
            <div className="py-10">
              <Spinner />
            </div>
          ) : null}

          <h2 className="mt-2 text-lg font-bold text-ink">Came with the app</h2>
          <ul className="mt-2 space-y-2">
            {BUILTIN_AUTOMATIONS.map((builtin) => {
              const row = byId.get(builtin.docId);
              const on = builtinEnabled(row);
              return (
                <Row key={builtin.key}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold text-ink">
                        {builtin.name}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-muted">
                        {builtin.what}
                      </p>
                      <p className="mt-1.5 text-sm font-semibold text-muted">
                        {builtin.when}
                        {builtin.textsCustomers
                          ? " · texts customers"
                          : " · stays inside the app"}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-muted">
                        {row?.lastRunAt
                          ? `Last run ${formatRelative(row.lastRunAt)}${
                              row.lastRunSummary
                                ? ` — ${row.lastRunSummary}`
                                : ""
                            }`
                          : "Never run. If this has been on for a while and still says never, the CRON_SECRET deployment variable is missing — nothing is calling it."}
                      </p>
                    </div>
                    <Switch
                      on={on}
                      busy={busyId === builtin.docId}
                      disabled={!isAdmin}
                      label={`${builtin.name} is ${on ? "on" : "off"}`}
                      onChange={(next) =>
                        void toggleBuiltin(
                          builtin.docId,
                          builtin.key,
                          builtin.name,
                          next,
                        )
                      }
                    />
                  </div>
                </Row>
              );
            })}
          </ul>

          <h2 className="mt-6 text-lg font-bold text-ink">Yours</h2>
          {custom.length === 0 ? (
            <p className="mt-2 text-base font-semibold text-muted">
              Nothing yet. An automation is one sentence — so many days after
              something happens, text the customer this — and you can see
              exactly who it would reach before you switch it on.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {custom.map((row) => (
                <Row key={row.id}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold text-ink">{row.name}</p>
                      <p className="mt-0.5 text-sm font-semibold text-muted">
                        {describeAutomation(row)}
                      </p>
                      {row.action.kind === "send_sms" && row.action.body ? (
                        <p className="mt-1.5 whitespace-pre-wrap rounded-xl bg-surface-1 p-2 text-sm font-semibold text-muted">
                          {row.action.body}
                        </p>
                      ) : null}
                      <p className="mt-1.5 text-sm font-semibold text-muted">
                        {row.lastRunAt
                          ? `Last run ${formatRelative(row.lastRunAt)}${
                              row.lastRunSummary
                                ? ` — ${row.lastRunSummary}`
                                : ""
                            }`
                          : row.enabled
                            ? "Armed, not run yet"
                            : "Off"}
                        {row.sentCount > 0
                          ? ` · ${row.sentCount} so far`
                          : ""}
                      </p>
                      {isAdmin ? (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            onClick={() =>
                              setEditing({
                                id: row.id,
                                name: row.name,
                                trigger: row.trigger,
                                conditions: row.conditions,
                                action: row.action,
                                guards: row.guards,
                              })
                            }
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busyId === row.id}
                            onClick={() => void remove(row)}
                          >
                            Delete
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <Switch
                      on={row.enabled}
                      busy={busyId === row.id}
                      disabled={!isAdmin}
                      label={`${row.name} is ${row.enabled ? "on" : "off"}`}
                      onChange={(next) => void toggleCustom(row, next)}
                    />
                  </div>
                </Row>
              ))}
            </ul>
          )}

          {!isAdmin ? (
            <p className="mt-6 text-sm font-semibold text-muted">
              Only the owner can change these. You can see what is running.
            </p>
          ) : null}
        </div>
      </div>

      {editing ? (
        <AutomationBuilderSheet
          open
          initial={editing}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={(value) => void save(value)}
        />
      ) : null}
    </div>
  );
}
