"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { subscribeExpenses, type Expense } from "@/lib/db/expenses";
import { subscribeTrips, type Trip } from "@/lib/db/mileage";
import { saveProfitSettings, useProfitSettings } from "@/lib/db/ownerSettings";
import { customerName, formatMoney } from "@/lib/format";
import { clientProfits, jobProfits, type ProfitJob } from "@/lib/jobProfit";
import { routes } from "@/lib/routes";
import type { Job } from "@/lib/types";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Profit per job and per client over the window Reports loaded, owner only
 * (ReportsScreen mounts it for the owner; the rates are owner-only in
 * firestore.rules). Least profitable clients first, with the per-visit price
 * that would reach the target margin.
 */
export function ProfitSection({ jobs }: { jobs: Job[] }) {
  const { author, users } = useTeam();
  const { byId: customersById } = useCustomers();
  const settings = useProfitSettings();
  const uid = author?.uid ?? "";
  const [trips, setTrips] = useState<Trip[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState("");
  const [perMile, setPerMile] = useState("");
  const [target, setTarget] = useState("");
  const [personRates, setPersonRates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const a = subscribeTrips({ uid, isOwner: true }, setTrips, () => setTrips([]));
    const b = subscribeExpenses({ uid, isOwner: true }, setExpenses, () => setExpenses([]));
    return () => {
      a();
      b();
    };
  }, [uid]);

  useEffect(() => {
    if (editing) return;
    setRate(String(settings.laborRatePerHour));
    setPerMile(String(settings.costPerMile));
    setTarget(String(settings.targetMarginPct));
    setPersonRates(Object.fromEntries(Object.entries(settings.ratesByUid).map(([k, v]) => [k, String(v)])));
  }, [settings, editing]);

  const results = useMemo(() => {
    const done: ProfitJob[] = jobs
      .filter((j) => j.status === "complete" && j.visitType === "service")
      .map((j) => {
        const c = customersById.get(j.customerId);
        return {
          id: j.id,
          customerId: j.customerId,
          price: j.price,
          assignedTo: j.assignedTo,
          scheduledStartMs: j.scheduledStart.toMillis(),
          scheduledEndMs: j.scheduledEnd.toMillis(),
          startedMs: j.startedAt?.toMillis() ?? null,
          finishedMs: j.finishedAt?.toMillis() ?? null,
          lat: c?.lat ?? 0,
          lng: c?.lng ?? 0,
        };
      });
    const costs = expenses
      .filter((e) => e.category === "fuel" || e.category === "supplies")
      .map((e) => ({ date: e.date, amount: e.amount }));
    const perJob = jobProfits(done, trips, costs, settings);
    return { perJob, clients: clientProfits(perJob, settings.targetMarginPct) };
  }, [jobs, customersById, trips, expenses, settings]);

  const revenue = results.perJob.reduce((s, j) => s + j.price, 0);
  const profit = results.perJob.reduce((s, j) => s + j.profit, 0);
  const worst = results.clients.filter((c) => c.jobs >= 2).slice(0, 8);

  async function save() {
    if (!author) return;
    const r = Number(rate);
    const m = Number(perMile);
    const t = Number(target);
    if (![r, m, t].every(Number.isFinite) || r < 0 || r > 500 || m < 0 || m > 5 || t < 0 || t > 90) {
      setError("Check the numbers: rate 0–500, per mile 0–5, margin 0–90.");
      return;
    }
    const ratesByUid: Record<string, number> = {};
    for (const [k, v] of Object.entries(personRates)) {
      const n = Number(v);
      if (v.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 500) ratesByUid[k] = n;
    }
    setError(null);
    await saveProfitSettings({ laborRatePerHour: r, costPerMile: m, targetMarginPct: t, ratesByUid }, author);
    setEditing(false);
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-lg font-bold text-ink">Profit by client</h2>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-line bg-surface-2 px-3 py-3">
          <p className="text-sm font-bold text-muted">Profit on finished jobs</p>
          <p className="mt-0.5 text-xl font-extrabold text-money tabular-nums">{formatMoney(profit)}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 px-3 py-3">
          <p className="text-sm font-bold text-muted">Margin</p>
          <p className="mt-0.5 text-xl font-extrabold text-ink tabular-nums">{revenue > 0 ? pct(profit / revenue) : "—"}</p>
        </div>
      </div>

      <h3 className="mt-4 mb-2 text-sm font-bold tracking-wide text-muted uppercase">Least profitable (2+ visits)</h3>
      {worst.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2 px-3 py-3 font-semibold text-muted">
          Not enough finished jobs yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {worst.map((c) => {
            const customer = customersById.get(c.customerId);
            return (
              <li key={c.customerId}>
                <Link
                  href={routes.customer(c.customerId)}
                  className="block rounded-xl border border-line bg-surface-2 px-3 py-2.5 hover:bg-surface-3"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-base font-bold text-ink">
                      {customer ? customerName(customer) : "Unknown client"}
                    </span>
                    <span className={`shrink-0 text-base font-extrabold tabular-nums ${c.margin < 0 ? "text-danger" : "text-ink"}`}>
                      {pct(c.margin)}
                    </span>
                  </span>
                  <span className="block text-sm font-semibold text-muted">
                    {c.jobs} visits · {formatMoney(c.averagePrice)} a visit · {formatMoney(c.profit)} profit
                    {c.suggestedPrice ? ` · charge ${formatMoney(c.suggestedPrice)} to make ${settings.targetMarginPct}%` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-3">
          <TextField label="Labor cost per person, $ an hour" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          {users.map((u) => (
            <TextField
              key={u.uid}
              label={`${u.displayName}'s rate (blank = default)`}
              inputMode="decimal"
              value={personRates[u.uid] ?? ""}
              onChange={(e) => setPersonRates({ ...personRates, [u.uid]: e.target.value })}
            />
          ))}
          <TextField label="Truck wear per mile, $ (fuel counted from expenses)" inputMode="decimal" value={perMile} onChange={(e) => setPerMile(e.target.value)} />
          <TextField label="Target margin, %" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          {error ? <p className="text-sm font-semibold text-danger">{error}</p> : null}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button full onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button full variant="secondary" onClick={() => setEditing(true)}>
            Labor and cost settings
          </Button>
        </div>
      )}
      <p className="mt-3 text-sm font-semibold text-muted">
        Each finished job: price, less time on site and driving at ${settings.laborRatePerHour}/h a person, truck wear
        at ${settings.costPerMile}/mi, and its share of the month&apos;s gas and supplies. Only you can see this.
      </p>
    </section>
  );
}
