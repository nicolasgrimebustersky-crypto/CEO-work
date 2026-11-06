"use client";

import { useEffect, useMemo, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextField } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import {
  deleteTrip,
  getMileageHome,
  logTrip,
  setMileageHome,
  subscribeTrips,
  type MileageHome,
  type Trip,
} from "@/lib/db/mileage";
import { saveMileageSettings, useMileageSettings } from "@/lib/db/settings";
import { localDate, parseAmount } from "@/lib/expenses";
import { formatMoney } from "@/lib/format";
import {
  MILEAGE_METHODS,
  MILEAGE_METHOD_LABEL,
  mileageTotals,
  rateFor,
} from "@/lib/mileage";

export function MileageScreen() {
  return <Mileage />;
}

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Business miles: what the job taps logged today and this year, what that is
 * worth at the IRS rate, and (owner) how mileage is claimed. Trips arrive
 * from "En route" and "Start" on each job (lib/autoMileage.ts); a drive the
 * taps missed can be added by hand. A crew member sees their own trips; the
 * owner sees everyone's — the same split firestore.rules enforces.
 */
function Mileage() {
  const { author, isAdmin } = useTeam();
  const settings = useMileageSettings();
  const uid = author?.uid ?? "";

  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [home, setHome] = useState<MileageHome | null>(null);
  const [manualMiles, setManualMiles] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualDate, setManualDate] = useState(localDate());
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    return subscribeTrips({ uid, isOwner: isAdmin }, setTrips, (err) => setError(err.message));
  }, [uid, isAdmin]);
  useEffect(() => {
    if (uid) void getMileageHome(uid).then(setHome);
  }, [uid]);

  const year = new Date().getFullYear();
  const mine = useMemo(() => (trips ?? []).filter((t) => t.createdBy === uid), [trips, uid]);
  const totals = useMemo(() => mileageTotals(trips ?? [], year), [trips, year]);
  const myTotals = useMemo(() => mileageTotals(mine, year), [mine, year]);
  const todayKey = localDate();
  const today = useMemo(() => {
    const list = (isAdmin ? trips ?? [] : mine).filter((t) => t.date === todayKey);
    return { ...mileageTotals(list, Number(todayKey.slice(0, 4))), trips: list };
  }, [trips, mine, isAdmin, todayKey]);

  async function logManual() {
    if (!author) return;
    const miles = parseAmount(manualMiles);
    if (miles === null || miles >= 2000) return setManualError("Enter the miles, like 12.4.");
    if (!manualReason.trim()) return setManualError("Say what the drive was for.");
    setManualError(null);
    await logTrip({ date: manualDate, miles, reason: manualReason, source: "manual", estimated: false }, author);
    setManualMiles("");
    setManualReason("");
  }

  function setHomeHere() {
    if (!uid || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Home" };
      void setMileageHome(uid, next).then(() => setHome(next));
    });
  }

  const rateNow = rateFor(localDate());

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={isAdmin ? "Mileage" : "My mileage"} subtitle={`${year} · IRS rate ${rateNow}¢ a mile`} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <p role="alert" className="mb-3 rounded-xl border border-danger/60 bg-danger/15 px-3 py-3 font-semibold text-ink">
            {error}
          </p>
        ) : null}

        {trips === null ? (
          <Spinner label="Loading trips…" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label={isAdmin ? `Business miles, ${year}` : `Your miles, ${year}`} value={`${(isAdmin ? totals : myTotals).miles} mi`} />
              {isAdmin ? (
                <Stat
                  label={settings.method === "standard" ? "Deduction at the IRS rate" : "Using actual truck costs"}
                  value={settings.method === "standard" ? formatMoney(totals.deduction) : "—"}
                />
              ) : (
                <Stat label="Trips logged" value={String(myTotals.count)} />
              )}
            </div>

            <section className="mt-5 rounded-2xl border border-line bg-surface-2 p-3">
              <h2 className="text-base font-bold text-ink">{isAdmin ? "Today, everyone" : "Today"}</h2>
              <p className="mt-1 text-2xl font-extrabold text-ink tabular-nums">
                {today.miles} mi
                {isAdmin && settings.method === "standard" ? (
                  <span className="ml-2 text-base font-bold text-money">{formatMoney(today.deduction)} write-off</span>
                ) : null}
              </p>
              <p className="mt-1 text-sm font-semibold text-muted">
                {today.count === 0
                  ? "Tap “En route” on a job and the drive there is logged here by itself."
                  : `${today.count} drive${today.count === 1 ? "" : "s"}, logged from the job taps.`}{" "}
                The drive from home to the first job is commuting and isn&apos;t counted
                {settings.homeIsMainOffice ? ", except that home is set as the main office" : ""}.
              </p>
            </section>

            <section className="mt-5 rounded-2xl border border-line bg-surface-2 p-3">
              <h2 className="text-base font-bold text-ink">Add a drive the taps missed</h2>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <TextField label="Miles" inputMode="decimal" value={manualMiles} onChange={(e) => setManualMiles(e.target.value)} />
                <TextField label="Date" type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
              </div>
              <div className="mt-2">
                <TextField label="What for" maxLength={200} placeholder="Supply run to the dealer" value={manualReason} onChange={(e) => setManualReason(e.target.value)} />
              </div>
              {manualError ? <p className="mt-2 text-sm font-semibold text-danger">{manualError}</p> : null}
              <div className="mt-3">
                <Button full onClick={() => void logManual()}>
                  Log drive
                </Button>
              </div>
            </section>

            <section className="mt-5 rounded-2xl border border-line bg-surface-2 p-3">
              <h2 className="text-base font-bold text-ink">Home</h2>
              <p className="mt-1 text-sm font-semibold text-muted">
                {home ? "Set." : "Not set."} Used only when home is the business&apos;s main office: it&apos;s where
                the first drive of the day starts if the phone can&apos;t give a location. Only you and the owner can
                see it.
              </p>
              <div className="mt-2">
                <Button variant="secondary" onClick={setHomeHere}>
                  {home ? "Move home to where I am now" : "Set home to where I am now"}
                </Button>
              </div>
            </section>

            {isAdmin ? <OwnerMileageSettings /> : null}

            <section className="mt-5">
              <h2 className="mb-2 text-lg font-bold text-ink">Trips</h2>
              {(trips ?? []).length === 0 ? (
                <p className="rounded-xl border border-line bg-surface-2 px-3 py-3 font-semibold text-muted">Nothing logged yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {(trips ?? []).map((t) => (
                    <li key={t.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-bold text-ink">{t.reason}</span>
                        <span className="block truncate text-sm font-semibold text-muted">
                          {[dayLabel(t.date), isAdmin && t.createdBy !== uid ? t.createdByName : "", t.estimated ? "estimated" : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-base font-extrabold text-ink tabular-nums">{t.miles} mi</span>
                      <button
                        type="button"
                        aria-label="Delete trip"
                        onClick={() => void deleteTrip(t.id)}
                        className="tap-target shrink-0 rounded-full px-2 text-muted hover:text-danger"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function OwnerMileageSettings() {
  const { author } = useTeam();
  const settings = useMileageSettings();
  const save = (next: typeof settings) => {
    if (author) void saveMileageSettings(next, author);
  };
  return (
    <section className="mt-5 rounded-2xl border border-line bg-surface-2 p-3">
      <h2 className="text-base font-bold text-ink">How mileage is claimed (owner)</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {MILEAGE_METHODS.map((m) => (
          <Chip key={m} active={settings.method === m} onClick={() => save({ ...settings, method: m })}>
            {MILEAGE_METHOD_LABEL[m]}
          </Chip>
        ))}
      </div>
      <p className="mt-2 text-sm font-semibold text-muted">
        One or the other for the same vehicle, not both. With the mileage rate, gas and truck upkeep expenses
        don&apos;t also count against profit in the tax estimate; with actual costs, logged miles don&apos;t.
        Switching methods for a vehicle has IRS limits, so check with your accountant.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={settings.homeIsMainOffice} onClick={() => save({ ...settings, homeIsMainOffice: !settings.homeIsMainOffice })}>
          Home is the business&apos;s main office
        </Chip>
      </div>
      <p className="mt-2 text-sm font-semibold text-muted">
        On: home to the first job counts as business. Off: it&apos;s commuting, and isn&apos;t logged.
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-3">
      <p className="text-sm font-bold text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold text-ink tabular-nums">{value}</p>
    </div>
  );
}
