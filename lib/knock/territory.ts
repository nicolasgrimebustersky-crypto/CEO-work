/**
 * Territories: an area of streets somebody owns, drawn on the map.
 *
 * A route is a list of doors you already have pins for. A territory is the
 * other half of door-knocking and the one this app could not express: the
 * streets you have *not* knocked yet. There are no pins there — that is the
 * point — so it cannot be a list of customer ids. It has to be a shape.
 *
 * Once a shape exists, everything else falls out of one question: is this point
 * inside it. Coverage is the pins inside. A route is the knockable pins inside.
 * A new pin dropped while walking belongs to whichever territory contains it,
 * without anybody filing it.
 *
 * Free of imports so it can be unit tested by running it, like the planner.
 */

export interface Point {
  lat: number;
  lng: number;
}

/** Three points is the fewest that enclose anything. */
export const MIN_VERTICES = 3;

/**
 * Is this point inside the polygon?
 *
 * Ray casting: count how many edges a ray heading east from the point crosses.
 * Odd means inside. It handles concave shapes and self-touching outlines, which
 * matters because a territory drawn around a subdivision follows the streets
 * and is rarely convex.
 *
 * Two details that are easy to get wrong and expensive to debug:
 *
 * The `(a.lat > lat) !== (b.lat > lat)` test uses strict inequality on one side
 * only. That is what stops a vertex exactly level with the ray being counted
 * twice — the classic symptom is a point that flickers in and out of a shape
 * depending on which vertex it happens to line up with.
 *
 * Longitude is treated as a plain coordinate rather than being projected. Over
 * one Kentucky county the error is far below the width of a driveway, and a
 * projection would buy nothing except a chance to get the maths wrong.
 */
export function isInside(point: Point, polygon: readonly Point[]): boolean {
  if (polygon.length < MIN_VERTICES) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];

    const straddles = a.lat > point.lat !== b.lat > point.lat;
    if (!straddles) continue;

    // Longitude of the edge where it crosses the point's latitude.
    const crossingLng = ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (point.lng < crossingLng) inside = !inside;
  }
  return inside;
}

/** Everything in `points` that falls inside the shape. */
export function within<T extends Point>(
  points: readonly T[],
  polygon: readonly Point[],
): T[] {
  if (polygon.length < MIN_VERTICES) return [];
  // A pin with no coordinates sits at 0,0 in the Atlantic. It is not in any
  // Kentucky territory, and letting it match would put every un-geocoded
  // import into whichever territory happened to contain the equator.
  return points.filter((p) => (p.lat !== 0 || p.lng !== 0) && isInside(p, polygon));
}

/** The smallest box containing the shape — for framing the map on it. */
export function boundsOf(polygon: readonly Point[]): {
  north: number;
  south: number;
  east: number;
  west: number;
} | null {
  if (polygon.length === 0) return null;
  return polygon.reduce(
    (box, p) => ({
      north: Math.max(box.north, p.lat),
      south: Math.min(box.south, p.lat),
      east: Math.max(box.east, p.lng),
      west: Math.min(box.west, p.lng),
    }),
    {
      north: polygon[0].lat,
      south: polygon[0].lat,
      east: polygon[0].lng,
      west: polygon[0].lng,
    },
  );
}

/** Where to put the label. The average of the vertices, which is good enough. */
export function centroidOf(polygon: readonly Point[]): Point | null {
  if (polygon.length === 0) return null;
  const sum = polygon.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / polygon.length, lng: sum.lng / polygon.length };
}

/**
 * Roughly how much ground it covers, in acres.
 *
 * The shoelace formula on degrees, scaled to metres. Longitude degrees shrink
 * towards the poles, so they are corrected by the cosine of the shape's own
 * latitude — without that, a territory in Kentucky reads about 25% too large.
 *
 * Approximate on purpose. It is there to answer "is this a morning or a week",
 * not to survey a boundary.
 */
const METERS_PER_DEGREE_LAT = 111_320;
const SQUARE_METERS_PER_ACRE = 4046.86;

export function acresOf(polygon: readonly Point[]): number {
  if (polygon.length < MIN_VERTICES) return 0;

  const middle = centroidOf(polygon);
  if (!middle) return 0;
  const lngScale = Math.cos((middle.lat * Math.PI) / 180) * METERS_PER_DEGREE_LAT;

  let twiceArea = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const ax = (polygon[j].lng - middle.lng) * lngScale;
    const ay = (polygon[j].lat - middle.lat) * METERS_PER_DEGREE_LAT;
    const bx = (polygon[i].lng - middle.lng) * lngScale;
    const by = (polygon[i].lat - middle.lat) * METERS_PER_DEGREE_LAT;
    twiceArea += ax * by - bx * ay;
  }

  return Math.abs(twiceArea / 2) / SQUARE_METERS_PER_ACRE;
}

export function formatAcres(acres: number): string {
  if (acres < 1) return "under an acre";
  if (acres < 10) return `${acres.toFixed(1)} acres`;
  return `${Math.round(acres)} acres`;
}

/**
 * What is wrong with this outline, in words, or null if nothing is.
 *
 * Returned as a sentence rather than a boolean because the only place it is
 * used is next to a Save button somebody just tapped, and "at least three
 * points" is more use than a disabled control with no explanation.
 */
export function boundaryProblem(polygon: readonly Point[]): string | null {
  if (polygon.length < MIN_VERTICES) {
    return "Drag a loop around the area you want.";
  }
  if (acresOf(polygon) < 0.05) {
    return "That shape is too small to hold a house. Draw a wider loop.";
  }
  return null;
}

/* ------------------------------------------------------- freehand drawing */

/**
 * A point on the screen, in pixels. Simplification happens here rather than in
 * degrees because the thing being removed is finger jitter, and jitter is a
 * fixed number of pixels whatever the map is zoomed to. Doing it in degrees
 * would smooth a street-level shape into a blob and leave a county-level one
 * untouched.
 */
export interface Pixel {
  x: number;
  y: number;
}

/** Roughly the width of the drawn line — below that, it is a wobble. */
export const SIMPLIFY_TOLERANCE = 3;

/**
 * A ceiling on stored vertices. A finger dragged around a subdivision produces
 * something like a thousand samples; every one of them is written to Firestore,
 * read back on every map load, and walked by `isInside` for every pin. A
 * hundred and twenty is far more than a neighbourhood outline needs.
 */
export const MAX_VERTICES = 120;

/**
 * How far a finger may wander during a tap and still count as a tap rather
 * than a drag. Nobody holds a phone still, and a two-pixel wobble read as a
 * drag becomes a three-point polygon the size of a doormat.
 */
export const TAP_SLOP = 10;

/** The furthest any sample strayed from the first — a gesture's size. */
export function dragSpread(path: readonly Pixel[]): number {
  if (path.length === 0) return 0;
  let worst = 0;
  for (const point of path) {
    worst = Math.max(worst, Math.hypot(point.x - path[0].x, point.y - path[0].y));
  }
  return worst;
}

/** Was that a tap (place one corner) or a drag (draw a loop)? */
export function isTap(path: readonly Pixel[]): boolean {
  return dragSpread(path) < TAP_SLOP;
}

/** Perpendicular distance from `p` to the segment `a`–`b`. */
function distanceToSegment(p: Pixel, a: Pixel, b: Pixel): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  // A zero-length segment: the two ends are the same point, so the
  // "perpendicular" is just the distance to it. Without this the projection
  // below divides by zero and every distance comes back NaN, which compares
  // false against the tolerance and silently keeps nothing.
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer–Douglas–Peucker: keep the points that carry the shape, drop the rest.
 *
 * Iterative with an explicit stack rather than recursive. A freehand drag can
 * be several thousand samples and the worst case for this algorithm recurses
 * once per point — a stack overflow in the middle of saving somebody's morning
 * of work is not a trade worth making for four lines of brevity.
 */
export function simplifyPath(path: readonly Pixel[], tolerance: number): Pixel[] {
  if (path.length <= 2) return [...path];

  const keep = new Array<boolean>(path.length).fill(false);
  keep[0] = true;
  keep[path.length - 1] = true;

  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    if (last - first < 2) continue;

    let farthest = -1;
    let worst = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const distance = distanceToSegment(path[i], path[first], path[last]);
      if (distance > worst) {
        worst = distance;
        farthest = i;
      }
    }

    if (farthest === -1) continue;
    keep[farthest] = true;
    stack.push([first, farthest], [farthest, last]);
  }

  return path.filter((_, index) => keep[index]);
}

/**
 * Simplify until the result fits under `limit`, loosening the tolerance as
 * needed. One pass at a fixed tolerance has no upper bound on its output — a
 * slow, careful drag around a cul-de-sac stays detailed at any tolerance a
 * street-level shape can afford.
 */
export function simplifyToLimit(
  path: readonly Pixel[],
  tolerance = SIMPLIFY_TOLERANCE,
  limit = MAX_VERTICES,
): Pixel[] {
  let current = simplifyPath(path, tolerance);
  let next = tolerance;
  // Doubling converges in a handful of rounds even from a thousand points, and
  // the guard means a pathological input ends rather than spinning.
  for (let round = 0; round < 12 && current.length > limit; round += 1) {
    next *= 2;
    current = simplifyPath(path, next);
  }
  return current;
}

/* --------------------------------------------------------------- coverage */

export interface Coverage {
  /** Pins inside the shape. */
  total: number;
  /** Pins that have never been contacted — the ones still to knock. */
  unknocked: number;
  /** Pins that turned into customers. */
  won: number;
  /** 0–1, share of the pins inside that have been contacted at least once. */
  fraction: number;
}

/**
 * How far through a territory you are.
 *
 * "Knocked" is `lastContactedAt` being set, which is what the quick-entry sheet
 * stamps the moment a pin is dropped at a door. So a territory's progress is a
 * genuine record of houses spoken to, not a checkbox somebody remembered to
 * tick.
 */
export function coverageOf(
  pins: readonly { lastContactedAt: unknown; status: string }[],
): Coverage {
  const total = pins.length;
  const unknocked = pins.filter((pin) => pin.lastContactedAt == null).length;
  const won = pins.filter((pin) => pin.status === "customer").length;
  return {
    total,
    unknocked,
    won,
    fraction: total === 0 ? 0 : (total - unknocked) / total,
  };
}
