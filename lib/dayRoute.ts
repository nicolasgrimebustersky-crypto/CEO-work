/**
 * The best order to drive a day's jobs in, from wherever the crew is now.
 *
 * Field-service apps (Jobber's "Optimize route", Housecall Pro, Workiz) all do
 * the same thing underneath: take the day's visits, a starting point (the
 * office, the visit you are at, or where the phone is), and reorder the visits
 * to cut total drive time, using road travel times where they have them. That
 * is a travelling-salesman problem, so nobody solves it exactly on a phone;
 * they build a good order fast and improve it. So does this:
 *
 *   1. Nearest neighbour from the start: always drive to the closest job left.
 *   2. 2-opt: reverse any stretch of the route that is shorter backwards
 *      (this is what untangles the crossed loops greedy leaves behind).
 *   3. Or-opt: lift any single job out and drop it where it costs least.
 *   Repeat 2 and 3 until nothing improves.
 *
 * For a day's worth of jobs (under ~25) this lands on or within a few percent
 * of the true best order, in well under a millisecond.
 *
 * The route is open: it starts at the start and ends at the last job, with no
 * drive home counted, because where the day ends is not a job.
 *
 * Promised times. A stop marked `fixed` was booked for a time the customer
 * was told, so the planner never reorders those among themselves: they keep
 * the schedule's order, and only the other stops move, fitted in around them
 * wherever they cost least (Jobber does the same with "anytime" visits).
 * retime() leaves a fixed visit's time alone and says when the route would
 * arrive late for it.
 *
 * Costs are minutes, from a matrix the caller fills — Google's road times when
 * the Distance Matrix API answers, a straight-line estimate when it does not.
 * Index 0 of the matrix is the start; 1..n are the stops in input order.
 *
 * Free of imports so it is tested by calling it.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RouteStop extends RoutePoint {
  id: string;
  /** Booked for a time the customer was promised: never reordered among the fixed ones. */
  fixed?: boolean;
}

/** A pin at 0,0 was never geocoded (see lib/types.ts): it has no place to route to. */
export function hasFix(p: RoutePoint): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0);
}

const EARTH_RADIUS_M = 6_371_000;
function metersBetween(a: RoutePoint, b: RoutePoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Straight-line drive time, the same model as estimateDriveMinutes in
 * lib/driveTime.ts (roads wind 35% more than a crow flies, 32 mph average)
 * without the parking minutes, which every order pays equally.
 */
export function estimateMinutes(a: RoutePoint, b: RoutePoint): number {
  const miles = (metersBetween(a, b) * 1.35) / 1609.34;
  return (miles / 32) * 60;
}

/** A full matrix of straight-line estimates, start first. */
export function estimateMatrix(start: RoutePoint, stops: readonly RoutePoint[]): number[][] {
  const points = [start, ...stops];
  return points.map((a) => points.map((b) => (a === b ? 0 : estimateMinutes(a, b))));
}

/** Total minutes driving `order` (indices into the matrix, start excluded) from the start. */
export function routeMinutes(order: readonly number[], matrix: readonly (readonly number[])[]): number {
  let total = 0;
  let at = 0;
  for (const next of order) {
    total += matrix[at][next];
    at = next;
  }
  return total;
}

function nearestNeighbour(n: number, matrix: readonly (readonly number[])[]): number[] {
  const left = new Set<number>();
  for (let i = 1; i <= n; i += 1) left.add(i);
  const order: number[] = [];
  let at = 0;
  while (left.size > 0) {
    let best = -1;
    let bestCost = Infinity;
    // Ascending index, strict less-than: ties go to the earlier job, so the
    // same day plans the same way twice.
    for (const i of left) {
      if (matrix[at][i] < bestCost) {
        bestCost = matrix[at][i];
        best = i;
      }
    }
    order.push(best);
    left.delete(best);
    at = best;
  }
  return order;
}

const EPS = 1e-9;

/** Reverse order[i..k] whenever that shortens the route. Handles asymmetric costs. */
type Feasible = (order: readonly number[]) => boolean;
const ANY: Feasible = () => true;

function twoOpt(order: number[], matrix: readonly (readonly number[])[], ok: Feasible = ANY): boolean {
  let improved = false;
  let current = routeMinutes(order, matrix);
  for (let i = 0; i < order.length - 1; i += 1) {
    for (let k = i + 1; k < order.length; k += 1) {
      const candidate = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
      const cost = routeMinutes(candidate, matrix);
      if (cost < current - EPS && ok(candidate)) {
        order.splice(0, order.length, ...candidate);
        current = cost;
        improved = true;
      }
    }
  }
  return improved;
}

/** Move one job to wherever it costs least. */
function orOpt(order: number[], matrix: readonly (readonly number[])[], ok: Feasible = ANY): boolean {
  let improved = false;
  let current = routeMinutes(order, matrix);
  for (let i = 0; i < order.length; i += 1) {
    const [job] = order.slice(i, i + 1);
    const without = [...order.slice(0, i), ...order.slice(i + 1)];
    for (let j = 0; j <= without.length; j += 1) {
      if (j === i) continue;
      const candidate = [...without.slice(0, j), job, ...without.slice(j)];
      const cost = routeMinutes(candidate, matrix);
      if (cost < current - EPS && ok(candidate)) {
        order.splice(0, order.length, ...candidate);
        current = cost;
        improved = true;
        break;
      }
    }
  }
  return improved;
}

export interface PlannedRoute {
  /** Stop ids in the order to drive them. Stops with no location come last. */
  order: string[];
  /** Ids that have no map location, so could not be placed. */
  unplaced: string[];
  /** Driving minutes along the planned order, from the start. */
  minutes: number;
  /** Driving minutes for the same stops in the order given, for "saves X min". */
  givenMinutes: number;
}

/**
 * Plans the order. `stops` arrive in their current order (the schedule's),
 * which is also the order "givenMinutes" measures. `matrix` covers the start
 * and every stop with a fix, start first, in the order those stops appear; a
 * missing or wrongly sized matrix falls back to straight-line estimates.
 */
export function planRoute(
  start: RoutePoint,
  stops: readonly RouteStop[],
  matrix?: readonly (readonly number[])[] | null,
): PlannedRoute {
  const placed = stops.filter(hasFix);
  const unplaced = stops.filter((s) => !hasFix(s)).map((s) => s.id);
  const n = placed.length;
  const costs =
    matrix && matrix.length === n + 1 && matrix.every((row) => row.length === n + 1)
      ? matrix
      : estimateMatrix(start, placed);

  const given = placed.map((_, i) => i + 1);
  const givenMinutes = routeMinutes(given, costs);
  if (n <= 1) {
    return { order: [...placed.map((s) => s.id), ...unplaced], unplaced, minutes: givenMinutes, givenMinutes };
  }

  // Matrix indices of the fixed stops, in the schedule's order.
  const fixedIdx = placed.map((s, i) => (s.fixed ? i + 1 : 0)).filter((i) => i > 0);
  const keepsFixedOrder: Feasible = (o) => {
    let next = 0;
    for (const i of o) {
      if (fixedIdx[next] === i) next += 1;
      else if (fixedIdx.includes(i)) return false;
    }
    return true;
  };

  let order: number[];
  if (fixedIdx.length === 0) {
    order = nearestNeighbour(n, costs);
  } else {
    // The fixed stops in their order, then each other stop fitted in where it
    // adds the least driving.
    order = [...fixedIdx];
    for (let i = 1; i <= n; i += 1) {
      if (fixedIdx.includes(i)) continue;
      let best = 0;
      let bestCost = Infinity;
      for (let at = 0; at <= order.length; at += 1) {
        const cost = routeMinutes([...order.slice(0, at), i, ...order.slice(at)], costs);
        if (cost < bestCost - EPS) {
          bestCost = cost;
          best = at;
        }
      }
      order.splice(best, 0, i);
    }
  }
  const ok = fixedIdx.length > 1 ? keepsFixedOrder : ANY;
  for (let pass = 0; pass < 50; pass += 1) {
    const a = twoOpt(order, costs, ok);
    const b = orOpt(order, costs, ok);
    if (!a && !b) break;
  }
  // Never hand back something worse than what the schedule already had.
  if (routeMinutes(order, costs) > givenMinutes + EPS) order = given;

  return {
    order: [...order.map((i) => placed[i - 1].id), ...unplaced],
    unplaced,
    minutes: routeMinutes(order, costs),
    givenMinutes,
  };
}

export interface TimedVisit {
  id: string;
  /** How long the visit is booked for, in minutes. */
  durationMinutes: number;
  /** A promised time: the visit keeps it, and the route waits for it. */
  fixedStart?: Date | null;
}

export interface RetimedVisit {
  id: string;
  start: Date;
  end: Date;
  /** Kept its promised time. */
  fixed: boolean;
  /** Minutes the route would arrive after the promised time (0 when on time). */
  lateMinutes: number;
}

/**
 * New start and end times for visits driven in this order: the first starts
 * at `firstStart`, each later one when the last finishes plus the drive to
 * it, rounded up to the next 5 minutes so the times read like a schedule.
 * `legMinutes[i]` is the drive INTO visit i (the first one's is ignored).
 *
 * A visit with a promised time keeps it: if the route gets there early it
 * waits, and if it would get there late the visit still keeps its time and
 * `lateMinutes` says by how much, for the screen to warn about.
 */
export function retime(
  visits: readonly TimedVisit[],
  legMinutes: readonly number[],
  firstStart: Date,
): RetimedVisit[] {
  const FIVE = 5 * 60_000;
  const out: RetimedVisit[] = [];
  let cursor = firstStart.getTime();
  visits.forEach((visit, i) => {
    if (i > 0) cursor = Math.ceil((cursor + (legMinutes[i] ?? 0) * 60_000) / FIVE) * FIVE;
    const duration = Math.max(0, visit.durationMinutes) * 60_000;
    if (visit.fixedStart) {
      const promised = visit.fixedStart.getTime();
      const lateMinutes = Math.max(0, Math.round((cursor - promised) / 60_000));
      out.push({ id: visit.id, start: new Date(promised), end: new Date(promised + duration), fixed: true, lateMinutes });
      cursor = Math.max(cursor, promised) + duration;
      return;
    }
    out.push({ id: visit.id, start: new Date(cursor), end: new Date(cursor + duration), fixed: false, lateMinutes: 0 });
    cursor += duration;
  });
  return out;
}

/**
 * Google Maps directions through every stop, in order, from the start.
 * Google's URL format takes up to 9 waypoints between origin and destination;
 * past that, the link covers the first ten stops and the screen says so.
 */
export function googleRouteUrl(start: RoutePoint | null, stops: readonly RoutePoint[]): string | null {
  const usable = stops.filter(hasFix).slice(0, 10);
  if (usable.length === 0) return null;
  const fmt = (p: RoutePoint) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const params = new URLSearchParams({ api: "1", travelmode: "driving" });
  if (start && hasFix(start)) params.set("origin", fmt(start));
  params.set("destination", fmt(usable[usable.length - 1]));
  const between = usable.slice(0, -1);
  if (between.length > 0) params.set("waypoints", between.map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
