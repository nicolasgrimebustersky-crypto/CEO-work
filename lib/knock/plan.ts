/**
 * Turning a pile of addresses into an order you can actually walk.
 *
 * A door-knocking route is a list of stops and the order you take them in. The
 * list is the easy half — you pick it off the map or out of a filter. The order
 * is what decides whether an afternoon is forty doors or twenty-five, because
 * the time goes into the driving between them, not the knocking.
 *
 * Deliberately free of imports so it can be unit tested by simply running it,
 * and so the ordering is one implementation rather than one per screen. The
 * haversine below is the canonical one — lib/geo.ts re-exports it rather than
 * keeping a second copy, because two distance functions in a codebase drift and
 * you find out when a route quietly starts ordering itself wrongly.
 */

export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

export function metersBetween(a: Point, b: Point): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** A stop only needs an identity and a position to be planned. */
export interface Stop extends Point {
  id: string;
}

/**
 * A walkable order, nearest unvisited stop each time.
 *
 * Greedy, not optimal. Finding the genuinely shortest tour is the travelling
 * salesman problem, which is NP-hard and which nobody should be solving on a
 * phone at a kerbside — and greedy lands within about a quarter of optimal on
 * clustered suburban addresses, which is what this is. More to the point, the
 * crew re-orders the last few stops by eye anyway, because they know which
 * street is one-way and which cul-de-sac is a pain to turn around in.
 *
 * Stable for equal distances: ties break towards whichever stop came first in
 * the input, so planning the same route twice gives the same answer and the
 * list does not shuffle under somebody's thumb.
 */
export function orderByNearest(stops: readonly Stop[], from: Point | null): Stop[] {
  if (stops.length <= 1) return [...stops];

  const remaining = [...stops];
  const ordered: Stop[] = [];

  // With no starting position — no GPS fix yet — the first stop in the list is
  // as good an anchor as any, and it keeps the result deterministic.
  let cursor: Point = from ?? remaining[0];

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Infinity;

    for (let i = 0; i < remaining.length; i += 1) {
      const distance = metersBetween(cursor, remaining[i]);
      // Strictly less-than: an equal distance leaves the earlier stop winning.
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    cursor = next;
  }

  return ordered;
}

/** Metres walked or driven across the whole route, in the given order. */
export function routeMeters(stops: readonly Stop[], from: Point | null = null): number {
  if (stops.length === 0) return 0;

  let total = 0;
  let cursor = from ?? stops[0];
  for (const stop of stops) {
    total += metersBetween(cursor, stop);
    cursor = stop;
  }
  return total;
}

/**
 * Roughly how long the route takes, end to end.
 *
 * Two components, and the knocking usually dominates: a couple of minutes at
 * each door whether or not anybody answers, plus the travel between them. The
 * travel figure is a straight-line estimate inflated for the fact that roads
 * bend — the same assumption the schedule's drive times fall back on when the
 * Distance Matrix API is unavailable, so the two screens never disagree.
 */
export const ROAD_WINDING_FACTOR = 1.35;
export const AVERAGE_MPH = 32;
/** A knock, a wait, and either a conversation or a walk back down the drive. */
export const MINUTES_PER_DOOR = 4;

export function estimateRouteMinutes(
  stops: readonly Stop[],
  from: Point | null = null,
  minutesPerDoor = MINUTES_PER_DOOR,
): number {
  if (stops.length === 0) return 0;
  const miles = (routeMeters(stops, from) * ROAD_WINDING_FACTOR) / 1609.34;
  const travel = (miles / AVERAGE_MPH) * 60;
  return Math.round(travel + stops.length * minutesPerDoor);
}

/** "1h 20m", "45m". Same shape as the schedule's drive times. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}m`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/* ------------------------------------------------------------- progress */

export interface RouteProgress {
  total: number;
  knocked: number;
  /** 0–1. Zero stops reads as zero rather than as NaN or as complete. */
  fraction: number;
  remaining: number;
  done: boolean;
}

export function routeProgress(
  stopIds: readonly string[],
  knockedIds: readonly string[],
): RouteProgress {
  const total = stopIds.length;
  // Counted against the stop list rather than by trusting the knocked list's
  // own length: a stop removed from the route after it was knocked would
  // otherwise push progress above 100%.
  const knockedSet = new Set(knockedIds);
  const knocked = stopIds.filter((id) => knockedSet.has(id)).length;

  return {
    total,
    knocked,
    fraction: total === 0 ? 0 : knocked / total,
    remaining: total - knocked,
    done: total > 0 && knocked === total,
  };
}

/**
 * The stop to walk up to next: the first one in order that has not been
 * knocked. Order matters here, so this cannot be `find` over a set.
 */
export function nextStop<T extends { id: string }>(
  stops: readonly T[],
  knockedIds: readonly string[],
): T | null {
  const knockedSet = new Set(knockedIds);
  return stops.find((stop) => !knockedSet.has(stop.id)) ?? null;
}
