/**
 * What a job actually made, and which clients are priced too low.
 *
 * Profit on a job = price
 *   − labour: hours on site plus the drive there, times each person on it,
 *     at their hourly cost (the owner's setting, per person if set)
 *   − mileage: miles driven to it, at the owner's cost per mile (wear and
 *     tear; fuel is counted separately below, so not twice)
 *   − its share of the month's fuel and supplies: those expenses spread over
 *     the month's finished jobs by hours on site.
 *
 * Time on site is the Start → Finish taps when both exist, else the booked
 * length. The drive is the logged trip into the job when there is one, else
 * a straight-line estimate from the same person's previous job that day.
 *
 * Owner only: labour rates are pay, and profit is the business's. The
 * settings live in ownerSettings (firestore.rules: owner reads and writes).
 *
 * Free of imports so it is tested by calling it.
 */

export interface ProfitSettings {
  /** Default hourly cost of a person, dollars. */
  laborRatePerHour: number;
  /** Per-person overrides, uid → dollars an hour. */
  ratesByUid: Record<string, number>;
  /** Wear and tear per mile, dollars (fuel is allocated from expenses). */
  costPerMile: number;
  /** The margin prices should leave, percent, for suggested increases. */
  targetMarginPct: number;
}

export const PROFIT_DEFAULTS: ProfitSettings = {
  laborRatePerHour: 25,
  ratesByUid: {},
  costPerMile: 0.25,
  targetMarginPct: 30,
};

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;

export function asProfitSettings(raw: unknown): ProfitSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rates: Record<string, number> = {};
  if (r.ratesByUid && typeof r.ratesByUid === "object") {
    for (const [uid, rate] of Object.entries(r.ratesByUid as Record<string, unknown>)) {
      if (typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 500) rates[uid] = rate;
    }
  }
  return {
    laborRatePerHour: num(r.laborRatePerHour, 0, 500, PROFIT_DEFAULTS.laborRatePerHour),
    ratesByUid: rates,
    costPerMile: num(r.costPerMile, 0, 5, PROFIT_DEFAULTS.costPerMile),
    targetMarginPct: num(r.targetMarginPct, 0, 90, PROFIT_DEFAULTS.targetMarginPct),
  };
}

export interface ProfitJob {
  id: string;
  customerId: string;
  price: number;
  assignedTo: readonly string[];
  /** Epoch ms. */
  scheduledStartMs: number;
  scheduledEndMs: number;
  startedMs: number | null;
  finishedMs: number | null;
  lat: number;
  lng: number;
}

export interface ProfitTrip {
  miles: number;
  jobIds: readonly string[];
}

export interface ProfitCost {
  /** "YYYY-MM-DD" */
  date: string;
  amount: number;
}

export interface JobProfit {
  jobId: string;
  customerId: string;
  price: number;
  onSiteHours: number;
  driveHours: number;
  miles: number;
  labor: number;
  mileage: number;
  allocated: number;
  cost: number;
  profit: number;
  /** Profit as a share of price; 0 when the price is 0. */
  margin: number;
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function hasFix(j: { lat: number; lng: number }): boolean {
  return Number.isFinite(j.lat) && Number.isFinite(j.lng) && !(j.lat === 0 && j.lng === 0);
}

function roadMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return ((2 * 6_371_000 * Math.asin(Math.sqrt(h))) * 1.35) / 1609.34;
}

const AVERAGE_MPH = 32;

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Profit for each finished job. `costs` are the fuel and supplies expenses to spread. */
export function jobProfits(
  jobs: readonly ProfitJob[],
  trips: readonly ProfitTrip[],
  costs: readonly ProfitCost[],
  settings: ProfitSettings,
): JobProfit[] {
  const hoursOf = (j: ProfitJob) => {
    const ms =
      j.startedMs !== null && j.finishedMs !== null && j.finishedMs > j.startedMs
        ? j.finishedMs - j.startedMs
        : Math.max(0, j.scheduledEndMs - j.scheduledStartMs);
    return ms / 3_600_000;
  };
  const rateOf = (uid: string) => settings.ratesByUid[uid] ?? settings.laborRatePerHour;

  // Miles into each job: a logged trip ending at it wins; else the straight
  // line from the same person's previous job that day.
  const tripInto = new Map<string, number>();
  for (const trip of trips) {
    const to = trip.jobIds[trip.jobIds.length - 1];
    if (to && Number.isFinite(trip.miles) && trip.miles > 0) tripInto.set(to, trip.miles);
  }
  const estimatedInto = new Map<string, number>();
  const byPersonDay = new Map<string, ProfitJob[]>();
  for (const job of jobs) {
    const at = job.startedMs ?? job.scheduledStartMs;
    for (const uid of job.assignedTo.length ? job.assignedTo : ["_"]) {
      const key = `${uid}|${localDay(at)}`;
      const list = byPersonDay.get(key) ?? [];
      list.push(job);
      byPersonDay.set(key, list);
    }
  }
  for (const list of byPersonDay.values()) {
    list.sort((a, b) => (a.startedMs ?? a.scheduledStartMs) - (b.startedMs ?? b.scheduledStartMs));
    for (let i = 1; i < list.length; i += 1) {
      if (hasFix(list[i - 1]) && hasFix(list[i]) && !estimatedInto.has(list[i].id)) {
        estimatedInto.set(list[i].id, roadMiles(list[i - 1], list[i]));
      }
    }
  }

  // The month's fuel and supplies, spread over the month's jobs by hours on site.
  const monthCost = new Map<string, number>();
  for (const c of costs) {
    if (Number.isFinite(c.amount) && c.amount > 0) monthCost.set(c.date.slice(0, 7), (monthCost.get(c.date.slice(0, 7)) ?? 0) + c.amount);
  }
  const monthHours = new Map<string, number>();
  for (const j of jobs) {
    const m = localDay(j.startedMs ?? j.scheduledStartMs).slice(0, 7);
    monthHours.set(m, (monthHours.get(m) ?? 0) + hoursOf(j));
  }

  return jobs.map((j) => {
    const crew = j.assignedTo.length ? j.assignedTo : ["_"];
    const onSiteHours = hoursOf(j);
    const miles = tripInto.get(j.id) ?? estimatedInto.get(j.id) ?? 0;
    const driveHours = miles / AVERAGE_MPH;
    const labor = crew.reduce((sum, uid) => sum + (onSiteHours + driveHours) * rateOf(uid), 0);
    const mileage = miles * settings.costPerMile;
    const month = localDay(j.startedMs ?? j.scheduledStartMs).slice(0, 7);
    const hoursThatMonth = monthHours.get(month) ?? 0;
    const allocated = hoursThatMonth > 0 ? ((monthCost.get(month) ?? 0) * onSiteHours) / hoursThatMonth : 0;
    const cost = labor + mileage + allocated;
    const price = Number.isFinite(j.price) && j.price > 0 ? j.price : 0;
    const profit = price - cost;
    return {
      jobId: j.id,
      customerId: j.customerId,
      price: round2(price),
      onSiteHours: round2(onSiteHours),
      driveHours: round2(driveHours),
      miles: round2(miles),
      labor: round2(labor),
      mileage: round2(mileage),
      allocated: round2(allocated),
      cost: round2(cost),
      profit: round2(profit),
      margin: price > 0 ? profit / price : 0,
    };
  });
}

export interface ClientProfit {
  customerId: string;
  jobs: number;
  revenue: number;
  profit: number;
  margin: number;
  /** Average price per visit now. */
  averagePrice: number;
  /** Per-visit price that would leave the target margin, rounded up to $5. Null if already there. */
  suggestedPrice: number | null;
}

/** Clients by profit margin, least profitable first. */
export function clientProfits(jobs: readonly JobProfit[], targetMarginPct: number): ClientProfit[] {
  const by = new Map<string, JobProfit[]>();
  for (const j of jobs) {
    const list = by.get(j.customerId) ?? [];
    list.push(j);
    by.set(j.customerId, list);
  }
  const target = Math.min(0.9, Math.max(0, targetMarginPct / 100));
  return [...by.entries()]
    .map(([customerId, list]) => {
      const revenue = list.reduce((s, j) => s + j.price, 0);
      const cost = list.reduce((s, j) => s + j.cost, 0);
      const profit = revenue - cost;
      const margin = revenue > 0 ? profit / revenue : 0;
      const averagePrice = revenue / list.length;
      const neededPrice = cost / list.length / (1 - target);
      const suggestedPrice = margin >= target || !Number.isFinite(neededPrice) ? null : Math.ceil(neededPrice / 5) * 5;
      return {
        customerId,
        jobs: list.length,
        revenue: round2(revenue),
        profit: round2(profit),
        margin,
        averagePrice: round2(averagePrice),
        suggestedPrice,
      };
    })
    .sort((a, b) => a.margin - b.margin);
}
