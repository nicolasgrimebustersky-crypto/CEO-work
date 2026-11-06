"use client";

import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { contractorThreshold } from "@/lib/cpaPacket";
import {
  CLASSIFICATION_LABEL,
  CLASSIFICATIONS,
  contractorStatus,
  dateKey,
  editMinutes,
  overtimeFor,
  maxRate,
  PAY_BASES,
  PAY_BASIS_LABEL,
  paidInYear,
  parseHours,
  payFor,
  periodPay,
  runFor,
  type Classification,
  type DayHours,
  type PayBasis,
  type PersonPay,
} from "@/lib/crewPay";
import {
  addTimeEdit,
  approveTimeEdit,
  deletePayRun,
  deleteTimeEdit,
  PAY_METHOD_LABEL,
  PAY_METHODS,
  recordPayRun,
  removeW9File,
  savePersonPay,
  subscribePayRuns,
  subscribeTimeEdits,
  uploadW9,
  usePaySettings,
  type PayMethod,
  type StoredPayRun,
  type StoredTimeEdit,
} from "@/lib/db/crewPay";
import { fetchJobsBetween } from "@/lib/db/jobs";
import { usePaySchedule } from "@/lib/db/settings";
import { formatMoneyExact } from "@/lib/format";
import { dailyWork, periodContaining, periodSummary, shiftPeriod } from "@/lib/payPeriods";
import type { Job } from "@/lib/types";

const money = (v: number) => formatMoneyExact(v);
const hrs = (v: number) => `${v.toFixed(2).replace(/\.?0+$/, "")} h`;
const signedHrs = (minutes: number) => `${minutes > 0 ? "+" : "−"}${hrs(Math.abs(minutes) / 60)}`;

/** The last day of a period whose end key is exclusive. */
function lastDayKey(endKey: string): string {
  const [y, m, d] = endKey.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}

function rateText(p: PersonPay): string {
  if (p.rate <= 0) return "No rate set";
  if (p.basis === "hourly") return `${money(p.rate)} an hour`;
  if (p.basis === "per_job") return `${money(p.rate)} a job`;
  return `${p.rate}% of job revenue`;
}

/**
 * Crew pay. The owner sees everyone: hours from the Start and Finish taps
 * plus corrections, pay at each person's rate, recording it as paid, and the
 * 1099 and W-9 flags. A crew member sees only themselves: their hours, a way
 * to fix them (which the owner approves), and what they have been paid.
 */
export function CrewPayScreen() {
  const { users, author, isAdmin } = useTeam();
  const uid = author?.uid ?? "";
  const schedule = usePaySchedule();
  const [steps, setSteps] = useState(0);
  const period = useMemo(() => shiftPeriod(periodContaining(new Date(), schedule), steps, schedule), [schedule, steps]);
  const startKey = dateKey(period.start);
  const endKey = dateKey(period.end);
  const lastDay = new Date(period.end.getTime() - 1);

  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [edits, setEdits] = useState<StoredTimeEdit[]>([]);
  const [runs, setRuns] = useState<StoredPayRun[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setJobs(null);
    // A job is paid in the period it was finished; look back far enough for
    // one scheduled earlier and finished late.
    const from = new Date(period.start.getTime() - 14 * 86_400_000);
    fetchJobsBetween(from, period.end)
      .then(setJobs)
      .catch(() => setJobs([]));
  }, [period.start, period.end]);

  useEffect(() => {
    if (!uid) return;
    const viewer = { uid, isOwner: isAdmin };
    const a = subscribeTimeEdits(viewer, setEdits, () => setEdits([]));
    const b = subscribePayRuns(viewer, setRuns, () => setRuns([]));
    return () => {
      a();
      b();
    };
  }, [uid, isAdmin]);

  // The owner pays the crew, not themselves: an owner's draw isn't payroll.
  const people = useMemo(
    () => (isAdmin ? users.filter((u) => u.uid !== uid) : users.filter((u) => u.uid === uid)),
    [users, uid, isAdmin],
  );
  const rows = useMemo(
    () => periodSummary(people.map((p) => p.uid), jobs ?? [], [], period),
    [people, jobs, period],
  );
  const pending = edits.filter((e) => !e.approved);

  // Overtime goes by the workweek, which can begin up to six days before the
  // period does; the jobs fetched above reach back 14 days.
  const weekStartsOn =
    schedule.frequency === "weekly" || schedule.frequency === "biweekly" ? schedule.startsOn : 0;
  const workWindow = useMemo(
    () => ({ start: new Date(period.start.getTime() - 7 * 86_400_000), end: period.end }),
    [period.start, period.end],
  );
  const daysFor = (personUid: string) => {
    const days = dailyWork(personUid, people.map((p) => p.uid), jobs ?? [], workWindow);
    for (const e of edits) {
      if (e.uid === personUid && e.approved) days.push({ date: e.date, hours: e.minutes / 60, jobs: 0, revenue: 0 });
    }
    return days;
  };
  const settings = usePaySettings(isAdmin);
  const nameOf = (id: string) => users.find((u) => u.uid === id)?.displayName ?? "Crew member";

  async function act(fn: () => Promise<void>, done: string) {
    try {
      await fn();
      setNote(done);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't save.");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Crew pay" subtitle={isAdmin ? "Hours, pay and 1099s" : "Your hours and pay"} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSteps((v) => v - 1)}
            aria-label="Previous pay period"
            className="tap-target rounded-full border border-line bg-surface-2 px-3 text-lg font-bold text-ink"
          >
            ‹
          </button>
          <p className="text-base font-bold text-ink">
            {format(period.start, "MMM d")} – {format(lastDay, "MMM d")}
            {steps === 0 ? <span className="ml-2 text-sm font-semibold text-muted">current</span> : null}
          </p>
          <button
            type="button"
            onClick={() => setSteps((v) => Math.min(0, v + 1))}
            disabled={steps === 0}
            aria-label="Next pay period"
            className="tap-target rounded-full border border-line bg-surface-2 px-3 text-lg font-bold text-ink disabled:opacity-40"
          >
            ›
          </button>
        </div>
        {note ? <p className="mt-2 text-sm font-semibold text-money">{note}</p> : null}

        {isAdmin && pending.length > 0 ? (
          <section className="mt-4 rounded-2xl border border-warn/60 bg-warn/10 p-3">
            <h2 className="text-base font-bold text-ink">Hour corrections waiting for you</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {pending.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold text-ink">
                    {nameOf(e.uid)} · {e.date} · <span className="tabular-nums">{signedHrs(e.minutes)}</span> — {e.reason}
                  </span>
                  <Button variant="secondary" onClick={() => void act(() => deleteTimeEdit(e.id), "Correction turned down.")}>
                    Turn down
                  </Button>
                  <Button onClick={() => author && void act(() => approveTimeEdit(e.id, author), "Correction approved.")}>
                    Approve
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {jobs === null ? <p className="mt-4 text-sm font-semibold text-muted">Loading the period&apos;s jobs…</p> : null}

        <ul className="mt-4 flex flex-col gap-3">
          {rows.map((row) => (
            <PersonCard
              key={row.uid}
              uid={row.uid}
              name={nameOf(row.uid)}
              work={{ hours: row.hours, jobs: row.jobs, revenue: row.revenue }}
              edits={edits}
              runs={runs}
              startKey={startKey}
              endKey={endKey}
              isOwner={isAdmin}
              person={isAdmin ? payFor(settings, row.uid) : null}
              days={isAdmin ? daysFor(row.uid) : []}
              weekStartsOn={weekStartsOn}
              onNote={setNote}
            />
          ))}
          {rows.length === 0 ? (
            <li className="rounded-2xl border border-line bg-surface-2 p-3 text-sm font-semibold text-muted">
              No one on the crew yet. Approve people on the Account screen and they appear here.
            </li>
          ) : null}
        </ul>

        {!isAdmin ? <MyPayHistory runs={runs} /> : null}

        <p className="mt-6 text-xs font-semibold text-muted">
          Hours come from the Start and Finish taps on each job (the scheduled time if one wasn&apos;t tapped), plus
          corrections. A correction never changes the taps; it is logged with a reason, and one you add for yourself
          counts once the owner approves it.
          {isAdmin
            ? " For a W-2 employee, Owed includes overtime: time and a half for hours past 40 in a workweek, or for the seventh day when all seven are worked (Kentucky), counted in the period the workweek ends. It is still gross pay only: withholding, payroll taxes and the W-2 itself come from a payroll service. Contractors are flagged at the year's 1099-NEC threshold, by the date paid."
            : ""}
        </p>
      </div>
    </div>
  );
}

function PersonCard({
  uid,
  name,
  work,
  edits,
  runs,
  startKey,
  endKey,
  isOwner,
  person,
  days,
  weekStartsOn,
  onNote,
}: {
  uid: string;
  name: string;
  work: { hours: number; jobs: number; revenue: number };
  edits: StoredTimeEdit[];
  runs: StoredPayRun[];
  startKey: string;
  endKey: string;
  isOwner: boolean;
  /** The owner's view only: the rate is never loaded on a crew member's phone. */
  person: PersonPay | null;
  /** Day-by-day work around the period, for overtime (owner's view only). */
  days: DayHours[];
  weekStartsOn: number;
  onNote: (note: string) => void;
}) {
  const { author } = useTeam();
  const minutes = editMinutes(edits, uid, startKey, endKey);
  const overtime = person ? overtimeFor(person, days, startKey, endKey, weekStartsOn) : undefined;
  const pay = periodPay(person ?? { classification: "1099", basis: "hourly", rate: 0, w9: null }, work, minutes, overtime);
  const run = runFor(runs, uid, startKey);
  const year = new Date().getFullYear();
  const paidYtd = paidInYear(runs, uid, year);
  const threshold = contractorThreshold(year);
  const status = person ? contractorStatus(person, paidYtd, threshold) : null;
  const theirEdits = edits.filter((e) => e.uid === uid && e.date >= startKey && e.date < endKey);

  const [panel, setPanel] = useState<"none" | "fix" | "pay" | "setup">("none");

  return (
    <li className="rounded-2xl border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-base font-bold text-ink">{name}</p>
        {person ? (
          <p className="text-sm font-semibold text-muted">
            {CLASSIFICATION_LABEL[person.classification]} · {rateText(person)}
          </p>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <Figure label="Hours" value={hrs(pay.hours)} />
        <Figure label="Jobs" value={String(pay.jobs)} />
        {isOwner ? <Figure label={run ? "Paid" : "Owed"} value={money(run ? run.gross : pay.gross)} money /> : null}
      </div>
      <p className="mt-1 text-xs font-semibold text-muted">
        {hrs(pay.tapHours)} from taps
        {pay.correctionHours !== 0 ? `, ${pay.correctionHours > 0 ? "+" : "−"}${hrs(Math.abs(pay.correctionHours))} corrected` : ""}
        {pay.pendingHours !== 0 ? ` · ${signedHrs(pay.pendingHours * 60)} waiting for the owner` : ""}
      </p>
      {isOwner && pay.overtimeHours > 0 ? (
        <p className="mt-1 text-xs font-bold text-warn">
          Includes overtime: {hrs(pay.overtimeHours)}, +{money(pay.overtimePremium)} (half-time premium on top of
          straight time, for hours past 40 in a workweek or a seventh day worked)
        </p>
      ) : null}

      {run ? (
        <p className="mt-2 text-sm font-semibold text-money">
          Paid {money(run.gross)} on {run.paidOn} · {PAY_METHOD_LABEL[run.method]}
          {isOwner && Math.abs(run.gross - pay.gross) >= 0.01 ? (
            <span className="text-warn"> · hours or rate changed since: now {money(pay.gross)}</span>
          ) : null}
        </p>
      ) : null}

      {status ? (
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
          {status.flag !== "employee" ? (
            <span
              className={`rounded-full px-2 py-1 ${
                status.flag === "needs_1099" ? "bg-warn/20 text-warn" : status.flag === "approaching" ? "bg-gold/20 text-gold" : "bg-surface-3 text-muted"
              }`}
            >
              {money(paidYtd)} paid in {year}
              {status.flag === "needs_1099"
                ? ` — needs a 1099-NEC (from ${money(threshold)})`
                : status.flag === "approaching"
                  ? ` — nearing the ${money(threshold)} 1099 line`
                  : ""}
            </span>
          ) : (
            <span className="rounded-full bg-surface-3 px-2 py-1 text-muted">{money(paidYtd)} gross in {year} — run it through payroll</span>
          )}
          {status.w9Missing ? <span className="rounded-full bg-warn/20 px-2 py-1 text-warn">No W-9 on file</span> : null}
        </div>
      ) : null}

      {theirEdits.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {theirEdits.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-xs font-semibold text-muted">
              <span className="min-w-0 flex-1">
                {e.date} · <span className="tabular-nums">{signedHrs(e.minutes)}</span> — {e.reason}
                {e.approved ? "" : " (waiting)"} · by {e.createdByName}
              </span>
              {isOwner || (!e.approved && e.createdBy === author?.uid) ? (
                <button
                  type="button"
                  className="font-bold text-danger"
                  onClick={() => void deleteTimeEdit(e.id).then(() => onNote("Correction removed."))}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setPanel(panel === "fix" ? "none" : "fix")}>
          {isOwner ? "Correct hours" : "Fix my hours"}
        </Button>
        {isOwner ? (
          <>
            <Button variant="secondary" onClick={() => setPanel(panel === "setup" ? "none" : "setup")}>
              Rate &amp; W-9
            </Button>
            <Button onClick={() => setPanel(panel === "pay" ? "none" : "pay")}>{run ? "Edit payment" : "Record as paid"}</Button>
          </>
        ) : null}
      </div>

      {panel === "fix" && author ? (
        <FixHours
          defaultDate={startKey}
          minDate={startKey}
          maxDate={lastDayKey(endKey)}
          isOwner={isOwner}
          onSave={async (date, mins, reason) => {
            await addTimeEdit({ uid, date, minutes: mins, reason }, author, isOwner);
            setPanel("none");
            onNote(isOwner ? "Hours corrected." : "Sent to the owner to approve.");
          }}
        />
      ) : null}

      {panel === "setup" && person && author ? (
        <PaySetup
          uid={uid}
          person={person}
          onDone={(n) => {
            setPanel("none");
            onNote(n);
          }}
        />
      ) : null}

      {panel === "pay" && person && author ? (
        <RecordPay
          gross={run?.gross ?? pay.gross}
          existing={run ?? null}
          onDelete={
            run
              ? async () => {
                  await deletePayRun(run.id);
                  setPanel("none");
                  onNote("Payment record removed.");
                }
              : null
          }
          onSave={async (gross, paidOn, method, notes) => {
            await recordPayRun(
              {
                uid,
                name,
                periodStart: startKey,
                periodEnd: endKey,
                hours: pay.hours,
                jobs: pay.jobs,
                basis: person.basis,
                rate: person.rate,
                gross,
                classification: person.classification,
                paidOn,
                method,
                notes,
              },
              author,
            );
            setPanel("none");
            onNote(`Recorded ${money(gross)} paid to ${name}.`);
          }}
        />
      ) : null}
    </li>
  );
}

function FixHours({
  defaultDate,
  minDate,
  maxDate,
  isOwner,
  onSave,
}: {
  defaultDate: string;
  minDate: string;
  maxDate: string;
  isOwner: boolean;
  onSave: (date: string, minutes: number, reason: string) => Promise<void>;
}) {
  const [date, setDate] = useState(defaultDate);
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const minutes = parseHours(hours);

  async function save() {
    if (minutes === null) return setError("Hours like 1.5, 1:30, or −0.5 to take time off.");
    if (!reason.trim()) return setError("Say why — the owner sees it.");
    if (date < minDate || date > maxDate) return setError("Pick a day in this pay period.");
    setBusy(true);
    try {
      await onSave(date, minutes, reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-line p-3">
      <TextField label="Day worked" type="date" value={date} min={minDate} max={maxDate} onChange={(e) => setDate(e.target.value)} />
      <TextField
        label="Hours to add (minus to take off)"
        inputMode="decimal"
        placeholder="1.5"
        value={hours}
        onChange={(e) => setHours(e.target.value)}
      />
      <TextField label="Why" maxLength={200} placeholder="Forgot to tap Finish at the Smith job" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error ? <p className="text-sm font-semibold text-danger">{error}</p> : null}
      <Button full onClick={() => void save()} disabled={busy}>
        {isOwner ? "Save correction" : "Send to the owner"}
      </Button>
    </div>
  );
}

function PaySetup({ uid, person, onDone }: { uid: string; person: PersonPay; onDone: (note: string) => void }) {
  const { author } = useTeam();
  const [classification, setClassification] = useState<Classification>(person.classification);
  const [basis, setBasis] = useState<PayBasis>(person.basis);
  const [rate, setRate] = useState(person.rate ? String(person.rate) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const rateNumber = Number(rate.replace(/[^0-9.]/g, ""));
  const rateOk = rate.trim() === "" || (Number.isFinite(rateNumber) && rateNumber >= 0 && rateNumber <= maxRate(basis));

  async function save(next: Partial<PersonPay>, done: string) {
    if (!author) return;
    if (!rateOk) return setError(`That rate looks wrong — at most ${basis === "share" ? "100%" : money(maxRate(basis))}.`);
    setBusy(true);
    try {
      await savePersonPay(uid, { classification, basis, rate: rate.trim() ? rateNumber : 0, w9: person.w9, ...next }, author);
      onDone(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function onW9(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const uploaded = await uploadW9(uid, f);
      const old = person.w9;
      await save({ w9: { ...uploaded, receivedOn: dateKey(new Date()) } }, "W-9 saved.");
      if (old) void removeW9File(old);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload it.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-line p-3">
      <SelectField label="Paid as" value={classification} onChange={(e) => setClassification(e.target.value as Classification)}>
        {CLASSIFICATIONS.map((c) => (
          <option key={c} value={c}>
            {CLASSIFICATION_LABEL[c]}
          </option>
        ))}
      </SelectField>
      <SelectField label="Pay" value={basis} onChange={(e) => setBasis(e.target.value as PayBasis)}>
        {PAY_BASES.map((b) => (
          <option key={b} value={b}>
            {PAY_BASIS_LABEL[b]}
          </option>
        ))}
      </SelectField>
      <TextField
        label={basis === "share" ? "Share (%)" : basis === "hourly" ? "Dollars an hour" : "Dollars a job"}
        inputMode="decimal"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
      />
      {error ? <p className="text-sm font-semibold text-danger">{error}</p> : null}
      <Button full onClick={() => void save({}, "Pay saved.")} disabled={busy}>
        Save pay
      </Button>

      <div className="border-t border-line pt-3">
        <p className="text-sm font-bold text-ink">W-9</p>
        <p className="text-xs font-semibold text-muted">
          {person.w9 ? `On file since ${person.w9.receivedOn || "—"}. ` : "None on file. "}
          A W-9 has their tax ID on it: only you can open it, not even the person it is for.
          {classification === "1099" ? " Get one before the first payment." : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {person.w9 ? (
            <a
              href={person.w9.url}
              target="_blank"
              rel="noopener noreferrer"
              className="tap-target inline-flex items-center rounded-full border border-line px-4 text-base font-semibold text-ink"
            >
              Open W-9
            </a>
          ) : null}
          <Button variant="secondary" onClick={() => file.current?.click()} disabled={busy}>
            {person.w9 ? "Replace W-9" : "Upload W-9"}
          </Button>
        </div>
        <input
          ref={file}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            void onW9(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

function RecordPay({
  gross,
  existing,
  onSave,
  onDelete,
}: {
  gross: number;
  existing: StoredPayRun | null;
  onSave: (gross: number, paidOn: string, method: PayMethod, notes: string) => Promise<void>;
  onDelete: (() => Promise<void>) | null;
}) {
  const [amount, setAmount] = useState(gross ? gross.toFixed(2) : "");
  const [paidOn, setPaidOn] = useState(existing?.paidOn ?? dateKey(new Date()));
  const [method, setMethod] = useState<PayMethod>(existing?.method ?? "cash");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const value = Number(amount.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(value) || value <= 0 || value >= 1_000_000) return setError("Enter what you paid.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return setError("Pick the day you paid.");
    setBusy(true);
    try {
      await onSave(Math.round(value * 100) / 100, paidOn, method, notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-line p-3">
      <TextField label="Amount paid ($)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <TextField label="Paid on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      <SelectField label="Paid with" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
        {PAY_METHODS.map((m) => (
          <option key={m} value={m}>
            {PAY_METHOD_LABEL[m]}
          </option>
        ))}
      </SelectField>
      <TextField label="Note (optional)" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <p className="text-xs font-semibold text-muted">
        Don&apos;t also log this under Expenses — crew pay is counted from here, in the tax estimate and the year-end packet.
      </p>
      {error ? <p className="text-sm font-semibold text-danger">{error}</p> : null}
      <div className="flex gap-2">
        {onDelete ? (
          <Button variant="secondary" onClick={() => void onDelete()} disabled={busy}>
            Remove
          </Button>
        ) : null}
        <Button full onClick={() => void save()} disabled={busy}>
          {existing ? "Save payment" : "Record payment"}
        </Button>
      </div>
    </div>
  );
}

function MyPayHistory({ runs }: { runs: StoredPayRun[] }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold text-ink">What you&apos;ve been paid</h2>
      {runs.length === 0 ? (
        <p className="mt-2 text-sm font-semibold text-muted">Nothing recorded yet. Pay shows here once the owner records it.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {runs.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-2xl border border-line bg-surface-2 px-3 py-2">
              <span className="text-sm font-semibold text-ink">
                {r.periodStart} – {lastDayKey(r.periodEnd)} · {hrs(r.hours)} · paid {r.paidOn}
              </span>
              <span className="text-base font-extrabold text-money tabular-nums">{money(r.gross)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Figure({ label, value, money: isMoney = false }: { label: string; value: string; money?: boolean }) {
  return (
    <div>
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className={`text-lg font-extrabold tabular-nums ${isMoney ? "text-money" : "text-ink"}`}>{value}</p>
    </div>
  );
}
