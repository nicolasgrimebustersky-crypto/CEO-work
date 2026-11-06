"use client";

import { useEffect, useMemo, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { SelectField, TextField } from "@/components/ui/Field";
import {
  deleteEquipment,
  deleteLogEntry,
  logMaintenance,
  newTaskId,
  saveEquipment,
  subscribeEquipment,
  subscribeMaintenanceLog,
  type StoredLogEntry,
} from "@/lib/db/maintenance";
import { localDate } from "@/lib/expenses";
import {
  allStatuses,
  dueText,
  latestReading,
  METER_UNIT,
  METERS,
  PRESETS,
  type Equipment,
  type MaintenanceTask,
  type Meter,
  type TaskState,
  type TaskStatus,
} from "@/lib/maintenance";

const STATE_STYLE: Record<TaskState, string> = {
  overdue: "border-danger/60 bg-danger/10 text-danger",
  due_soon: "border-warn/60 bg-warn/10 text-warn",
  never_logged: "border-line bg-surface-2 text-muted",
  ok: "border-line bg-surface-2 text-money",
};

const METER_LABEL: Record<Meter, string> = { none: "No meter (by date only)", hours: "Hour meter", miles: "Odometer" };

/**
 * Equipment and what it needs: oil changes, blades, grease, the truck's
 * service. Everyone on the crew sees what's due and logs what they did; the
 * daily check sends one reminder when something comes due soon and one when
 * it's overdue. A repair expense for the same equipment can tick off tasks
 * too (Expenses), so paying for the work and logging it is one step.
 */
export function EquipmentScreen() {
  const { author, isAdmin } = useTeam();
  const [equipment, setEquipment] = useState<Equipment[] | null>(null);
  const [log, setLog] = useState<StoredLogEntry[]>([]);
  const [editing, setEditing] = useState<Equipment | "new" | null>(null);
  const [logging, setLogging] = useState<{ equipment: Equipment; taskIds: string[]; readingOnly: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const today = localDate();

  useEffect(() => {
    const a = subscribeEquipment(setEquipment, () => setEquipment([]));
    const b = subscribeMaintenanceLog(setLog, () => setLog([]));
    return () => {
      a();
      b();
    };
  }, []);

  const statuses = useMemo(() => allStatuses(equipment ?? [], log, today), [equipment, log, today]);
  const due = statuses.filter((s) => s.state === "overdue" || s.state === "due_soon");
  const byId = new Map((equipment ?? []).map((e) => [e.id, e]));

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Equipment" subtitle="Service reminders by date, hours or miles">
        <div className="mt-3 flex justify-end">
          <Button onClick={() => setEditing("new")}>Add equipment</Button>
        </div>
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {note ? <p className="mb-3 text-sm font-semibold text-money">{note}</p> : null}

        {editing ? (
          <EquipmentForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSave={async (item) => {
              if (!author) return;
              await saveEquipment(item, author);
              setEditing(null);
              setNote(`${item.name} saved.`);
            }}
            onDelete={
              editing !== "new" && isAdmin
                ? async () => {
                    await deleteEquipment(editing.id);
                    setEditing(null);
                    setNote("Removed. Its service history stays in the log.");
                  }
                : null
            }
          />
        ) : null}

        {logging && author ? (
          <LogForm
            key={`${logging.equipment.id}:${logging.readingOnly}:${logging.taskIds.join(",")}`}
            equipment={logging.equipment}
            initialTaskIds={logging.taskIds}
            readingOnly={logging.readingOnly}
            lastReading={latestReading(logging.equipment.id, log)?.value ?? null}
            onCancel={() => setLogging(null)}
            onSave={async (entry) => {
              await logMaintenance({ ...entry, equipmentId: logging.equipment.id }, author);
              setLogging(null);
              setNote(entry.taskIds.length ? "Logged. Those reminders start over." : "Reading saved.");
            }}
          />
        ) : null}

        {due.length > 0 ? (
          <section className="mb-5">
            <h2 className="mb-2 text-lg font-bold text-ink">Due now</h2>
            <ul className="flex flex-col gap-2">
              {due.map((s) => (
                <DueRow
                  key={`${s.equipmentId}:${s.task.id}`}
                  status={s}
                  meter={byId.get(s.equipmentId)?.meter ?? "none"}
                  onDone={() => {
                    const e = byId.get(s.equipmentId);
                    if (e) setLogging({ equipment: e, taskIds: [s.task.id], readingOnly: false });
                  }}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {equipment === null ? <p className="text-sm font-semibold text-muted">Loading…</p> : null}
        {equipment?.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface-2 p-3 text-sm font-semibold text-muted">
            Nothing yet. Add the mowers, the truck and the trimmers, pick a starting set of service tasks, and log
            the last time each was done to start the clocks.
          </p>
        ) : null}

        <ul className="flex flex-col gap-3">
          {(equipment ?? []).map((e) => {
            const reading = latestReading(e.id, log);
            const mine = statuses.filter((s) => s.equipmentId === e.id);
            const history = log.filter((l) => l.equipmentId === e.id).slice(0, 5);
            return (
              <li key={e.id} className="rounded-2xl border border-line bg-surface-2 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-bold text-ink">{e.name}</p>
                  {e.meter !== "none" ? (
                    <p className="text-sm font-semibold text-muted">
                      {reading ? `${reading.value} ${METER_UNIT[e.meter]} on ${reading.date}` : `No ${METER_UNIT[e.meter]} logged`}
                    </p>
                  ) : null}
                </div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {mine.map((s) => (
                    <li key={s.task.id} className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-semibold text-ink">{s.task.what}</span>
                      <span className={`text-right font-semibold ${STATE_STYLE[s.state].split(" ").pop()}`}>{dueText(s, e.meter)}</span>
                    </li>
                  ))}
                  {mine.length === 0 ? <li className="text-sm font-semibold text-muted">No service tasks yet — edit to add some.</li> : null}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={() => setLogging({ equipment: e, taskIds: [], readingOnly: false })} disabled={e.tasks.length === 0}>
                    Log service
                  </Button>
                  {e.meter !== "none" ? (
                    <Button variant="secondary" onClick={() => setLogging({ equipment: e, taskIds: [], readingOnly: true })}>
                      {e.meter === "hours" ? "Update hours" : "Update miles"}
                    </Button>
                  ) : null}
                  <Button variant="secondary" onClick={() => setEditing(e)}>
                    Edit
                  </Button>
                </div>
                {history.length > 0 ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-bold text-muted">Recent log</summary>
                    <ul className="mt-1 flex flex-col gap-1">
                      {history.map((h) => (
                        <li key={h.id} className="flex items-center gap-2 text-xs font-semibold text-muted">
                          <span className="min-w-0 flex-1">
                            {h.date} ·{" "}
                            {h.taskIds.length
                              ? h.taskIds.map((t) => e.tasks.find((x) => x.id === t)?.what ?? "a removed task").join(", ")
                              : "Reading"}
                            {h.reading != null ? ` · ${h.reading} ${METER_UNIT[e.meter]}` : ""}
                            {h.expenseId ? " · from an expense" : ""} · {h.createdByName}
                          </span>
                          {isAdmin || h.createdBy === author?.uid ? (
                            <button type="button" className="font-bold text-danger" onClick={() => void deleteLogEntry(h.id)}>
                              Remove
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>

        <p className="mt-6 text-xs font-semibold text-muted">
          A reminder goes out once when a task is coming due and once when it is overdue — to everyone who has
          Schedule notifications on. Paid for the work? Log it under Expenses as a repair for this equipment and
          tick the tasks there instead.
        </p>
      </div>
    </div>
  );
}

function DueRow({ status, meter, onDone }: { status: TaskStatus; meter: Meter; onDone: () => void }) {
  return (
    <li className={`flex items-center gap-2 rounded-2xl border p-3 ${STATE_STYLE[status.state]}`}>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold text-ink">
          {status.equipmentName} · {status.task.what}
        </p>
        <p className="text-sm font-semibold">{dueText(status, meter)}</p>
      </div>
      <Button variant="secondary" onClick={onDone}>
        Done
      </Button>
    </li>
  );
}

function LogForm({
  equipment,
  initialTaskIds,
  readingOnly,
  lastReading,
  onSave,
  onCancel,
}: {
  equipment: Equipment;
  initialTaskIds: string[];
  readingOnly: boolean;
  lastReading: number | null;
  onSave: (entry: { date: string; taskIds: string[]; reading: number | null; note: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(localDate());
  const [taskIds, setTaskIds] = useState<string[]>(initialTaskIds);
  const [reading, setReading] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unit = METER_UNIT[equipment.meter];

  async function save() {
    const value = reading.trim() ? Number(reading.replace(/[^0-9.]/g, "")) : null;
    if (value != null && (!Number.isFinite(value) || value < 0)) return setError(`That doesn't look like ${unit}.`);
    if (readingOnly && value == null) return setError(`Enter the ${unit}.`);
    if (!readingOnly && taskIds.length === 0) return setError("Tick what was done.");
    if (value != null && lastReading != null && value < lastReading && !confirm(`That's less than the last reading (${lastReading}). Save it anyway?`)) return;
    setBusy(true);
    try {
      await onSave({ date, taskIds: readingOnly ? [] : taskIds, reading: value, note });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save.");
      setBusy(false);
    }
  }

  return (
    <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-accent/60 bg-accent/5 p-3">
      <h2 className="text-base font-bold text-ink">
        {readingOnly ? `${equipment.name}: ${unit}` : `Log service on the ${equipment.name}`}
      </h2>
      {!readingOnly ? (
        <div className="flex flex-wrap gap-2">
          {equipment.tasks.map((t) => {
            const on = taskIds.includes(t.id);
            return (
              <Chip key={t.id} active={on} onClick={() => setTaskIds(on ? taskIds.filter((x) => x !== t.id) : [...taskIds, t.id])}>
                {t.what}
              </Chip>
            );
          })}
        </div>
      ) : null}
      <TextField label="Date" type="date" value={date} max={localDate()} onChange={(e) => setDate(e.target.value)} />
      {equipment.meter !== "none" ? (
        <TextField
          label={`${equipment.meter === "miles" ? "Odometer" : "Hour meter"} (${unit})${readingOnly ? "" : ", if you have it"}`}
          inputMode="decimal"
          placeholder={lastReading != null ? `Last: ${lastReading}` : ""}
          value={reading}
          onChange={(e) => setReading(e.target.value)}
        />
      ) : null}
      {!readingOnly ? <TextField label="Note (optional)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /> : null}
      {error ? <p className="text-sm font-semibold text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button full onClick={() => void save()} disabled={busy}>
          Save
        </Button>
      </div>
    </section>
  );
}

type DraftTask = { id: string; what: string; days: string; units: string };

function EquipmentForm({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: Equipment | null;
  onSave: (item: { id?: string; name: string; meter: Meter; tasks: MaintenanceTask[] }) => Promise<void>;
  onCancel: () => void;
  onDelete: (() => Promise<void>) | null;
}) {
  const toDraft = (t: Omit<MaintenanceTask, "id"> & { id?: string }): DraftTask => ({
    id: t.id ?? newTaskId(),
    what: t.what,
    days: t.everyDays ? String(t.everyDays) : "",
    units: t.everyUnits ? String(t.everyUnits) : "",
  });
  const [name, setName] = useState(initial?.name ?? "");
  const [meter, setMeter] = useState<Meter>(initial?.meter ?? "hours");
  const [tasks, setTasks] = useState<DraftTask[]>((initial?.tasks ?? []).map(toDraft));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function preset(key: string) {
    const p = PRESETS[key];
    if (!p) return;
    if (!name.trim()) setName(key.split(" / ")[0]);
    setMeter(p.meter);
    setTasks(p.tasks.map(toDraft));
  }

  async function save() {
    if (!name.trim()) return setError("Give it a name — the same one you use on expenses.");
    const out: MaintenanceTask[] = [];
    for (const t of tasks) {
      if (!t.what.trim()) continue;
      const days = t.days.trim() ? Math.round(Number(t.days)) : null;
      const units = meter !== "none" && t.units.trim() ? Number(t.units) : null;
      if ((days != null && !(days > 0 && days <= 3650)) || (units != null && !(units > 0 && units < 1_000_000))) {
        return setError(`Check the interval on “${t.what}”.`);
      }
      if (!days && !units) return setError(`“${t.what}” needs an interval: every so many days${meter !== "none" ? ` or ${METER_UNIT[meter]}` : ""}.`);
      out.push({ id: t.id, what: t.what.trim(), everyDays: days, everyUnits: units });
    }
    setBusy(true);
    try {
      await onSave({ id: initial?.id, name, meter, tasks: out });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save.");
      setBusy(false);
    }
  }

  return (
    <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-accent/60 bg-accent/5 p-3">
      <h2 className="text-base font-bold text-ink">{initial ? `Edit ${initial.name}` : "Add equipment"}</h2>
      {!initial ? (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Start from</p>
          <div className="flex flex-wrap gap-2">
            {Object.keys(PRESETS).map((k) => (
              <Chip key={k} active={false} onClick={() => preset(k)}>
                {k}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      <TextField label="Name" placeholder="Zero-turn, F-150, Stihl trimmer" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      <SelectField label="Tracks" value={meter} onChange={(e) => setMeter(e.target.value as Meter)}>
        {METERS.map((m) => (
          <option key={m} value={m}>
            {METER_LABEL[m]}
          </option>
        ))}
      </SelectField>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-ink">Service tasks</p>
        {tasks.map((t, i) => (
          <div key={t.id} className="grid grid-cols-[1fr_4.5rem_4.5rem_auto] items-end gap-2">
            <TextField label={i === 0 ? "Task" : ""} value={t.what} maxLength={80} onChange={(e) => setTasks(tasks.map((x) => (x.id === t.id ? { ...x, what: e.target.value } : x)))} />
            <TextField label={i === 0 ? "Days" : ""} inputMode="numeric" value={t.days} onChange={(e) => setTasks(tasks.map((x) => (x.id === t.id ? { ...x, days: e.target.value } : x)))} />
            <TextField
              label={i === 0 ? (meter === "none" ? "—" : meter === "hours" ? "Hours" : "Miles") : ""}
              inputMode="decimal"
              disabled={meter === "none"}
              value={meter === "none" ? "" : t.units}
              onChange={(e) => setTasks(tasks.map((x) => (x.id === t.id ? { ...x, units: e.target.value } : x)))}
            />
            <button
              type="button"
              aria-label={`Remove ${t.what || "task"}`}
              className="tap-target px-2 text-lg font-bold text-danger"
              onClick={() => setTasks(tasks.filter((x) => x.id !== t.id))}
            >
              ×
            </button>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setTasks([...tasks, { id: newTaskId(), what: "", days: "", units: "" }])}>
          Add a task
        </Button>
        <p className="text-xs font-semibold text-muted">Every so many days, {meter === "none" ? "" : `or ${METER_UNIT[meter]}, `}whichever comes first.</p>
      </div>
      {error ? <p className="text-sm font-semibold text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {onDelete ? (
          confirmDelete ? (
            <Button variant="danger" onClick={() => void onDelete()} disabled={busy}>
              Delete it
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmDelete(true)} disabled={busy}>
              Delete
            </Button>
          )
        ) : null}
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button full onClick={() => void save()} disabled={busy}>
          Save
        </Button>
      </div>
    </section>
  );
}
