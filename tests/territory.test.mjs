/**
 * Tests for territory geometry.
 *
 * Point-in-polygon is the whole feature: coverage, "turn this into a route",
 * and which territory a new pin belongs to are all the same question asked
 * three ways. It is also the kind of code that looks right and is subtly wrong
 * — a vertex exactly level with the test ray gets counted twice under the
 * obvious implementation, and the symptom is a house that flickers in and out
 * of a territory depending on nothing the user can see.
 *
 * So the awkward cases are here on purpose: concave shapes, points on the
 * boundary, vertices in line with the ray, and reversed winding.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  MAX_VERTICES,
  MIN_VERTICES,
  SIMPLIFY_TOLERANCE,
  acresOf,
  boundaryProblem,
  boundsOf,
  centroidOf,
  coverageOf,
  formatAcres,
  isInside,
  TAP_SLOP,
  isTap,
  dragSpread,
  simplifyPath,
  simplifyToLimit,
  within,
} = await import("../lib/knock/territory.ts");

/** A square roughly 1km on a side, near La Grange. */
const SQUARE = [
  { lat: 38.40, lng: -85.38 },
  { lat: 38.41, lng: -85.38 },
  { lat: 38.41, lng: -85.37 },
  { lat: 38.40, lng: -85.37 },
];

/** A C-shape: the bite is taken out of the east side. */
const CONCAVE = [
  { lat: 38.40, lng: -85.38 },
  { lat: 38.44, lng: -85.38 },
  { lat: 38.44, lng: -85.34 },
  { lat: 38.43, lng: -85.34 },
  { lat: 38.43, lng: -85.37 },
  { lat: 38.41, lng: -85.37 },
  { lat: 38.41, lng: -85.34 },
  { lat: 38.40, lng: -85.34 },
];

describe("inside or out", () => {
  test("the middle is inside", () => {
    assert.equal(isInside({ lat: 38.405, lng: -85.375 }, SQUARE), true);
  });

  test("well outside is outside", () => {
    assert.equal(isInside({ lat: 38.5, lng: -85.375 }, SQUARE), false);
    assert.equal(isInside({ lat: 38.405, lng: -85.5 }, SQUARE), false);
    assert.equal(isInside({ lat: 38.3, lng: -85.2 }, SQUARE), false);
  });

  test("the bite out of a concave shape is outside it", () => {
    // Inside the bounding box, outside the actual outline. A convex-hull
    // shortcut would get this wrong and quietly hand somebody a street that
    // belongs to the other person.
    assert.equal(isInside({ lat: 38.42, lng: -85.35 }, CONCAVE), false);
    // And the two arms are inside.
    assert.equal(isInside({ lat: 38.405, lng: -85.35 }, CONCAVE), true);
    assert.equal(isInside({ lat: 38.435, lng: -85.35 }, CONCAVE), true);
  });

  test("a point level with a vertex is not counted twice", () => {
    // The classic ray-casting bug. 38.41 is the latitude of two vertices of
    // SQUARE; a naive test double-counts the crossing and reports "outside"
    // for a point that is plainly within the shape's span.
    assert.equal(isInside({ lat: 38.41, lng: -85.375 }, SQUARE), false, "on the top edge");
    assert.equal(isInside({ lat: 38.4099, lng: -85.375 }, SQUARE), true, "just inside it");
  });

  test("winding direction does not matter", () => {
    const reversed = [...SQUARE].reverse();
    assert.equal(isInside({ lat: 38.405, lng: -85.375 }, reversed), true);
    assert.equal(isInside({ lat: 38.5, lng: -85.375 }, reversed), false);
  });

  test("a shape that is not a shape contains nothing", () => {
    assert.equal(isInside({ lat: 38.405, lng: -85.375 }, []), false);
    assert.equal(isInside({ lat: 38.405, lng: -85.375 }, SQUARE.slice(0, 2)), false);
  });
});

describe("what falls inside", () => {
  const pins = [
    { id: "in", lat: 38.405, lng: -85.375 },
    { id: "out", lat: 38.5, lng: -85.5 },
    { id: "ungeocoded", lat: 0, lng: 0 },
  ];

  test("keeps the ones inside", () => {
    assert.deepEqual(
      within(pins, SQUARE).map((p) => p.id),
      ["in"],
    );
  });

  test("an un-geocoded pin belongs to nowhere", () => {
    // 0,0 is in the Atlantic. Letting it match would sweep every import that
    // failed to geocode into whichever territory happens to contain it.
    const atlantic = [
      { lat: 1, lng: -1 },
      { lat: -1, lng: -1 },
      { lat: -1, lng: 1 },
      { lat: 1, lng: 1 },
    ];
    assert.deepEqual(within(pins, atlantic), []);
  });

  test("no shape means nothing inside, not everything", () => {
    assert.deepEqual(within(pins, []), []);
  });
});

describe("measuring one", () => {
  test("a square kilometre is about 247 acres", () => {
    const acres = acresOf(SQUARE);
    assert.ok(Math.abs(acres - 247) < 25, `got ${acres.toFixed(1)} acres`);
  });

  test("longitude is corrected for latitude", () => {
    // The same span of degrees covers less ground further north. Without the
    // cosine correction these would come out identical.
    const north = SQUARE.map((p) => ({ lat: p.lat + 20, lng: p.lng }));
    assert.ok(acresOf(north) < acresOf(SQUARE), "a northern shape should be smaller");
  });

  test("winding direction does not flip the sign", () => {
    assert.ok(Math.abs(acresOf([...SQUARE].reverse()) - acresOf(SQUARE)) < 0.01);
  });

  test("a non-shape has no area", () => {
    assert.equal(acresOf(SQUARE.slice(0, 2)), 0);
    assert.equal(acresOf([]), 0);
  });

  test("reads as English", () => {
    assert.equal(formatAcres(0.4), "under an acre");
    assert.equal(formatAcres(3.25), "3.3 acres");
    assert.equal(formatAcres(247.4), "247 acres");
  });
});

describe("framing one", () => {
  test("the box wraps every vertex", () => {
    assert.deepEqual(boundsOf(SQUARE), {
      north: 38.41,
      south: 38.4,
      east: -85.37,
      west: -85.38,
    });
  });

  test("the centre is in the middle", () => {
    const middle = centroidOf(SQUARE);
    assert.ok(Math.abs(middle.lat - 38.405) < 1e-9);
    assert.ok(Math.abs(middle.lng - -85.375) < 1e-9);
  });

  test("nothing to frame", () => {
    assert.equal(boundsOf([]), null);
    assert.equal(centroidOf([]), null);
  });
});

describe("what stops you saving one", () => {
  test("too few points says so in words", () => {
    // It has to name the gesture, not the vertex count. Somebody looking at a
    // greyed-out Save button needs to know what to do with their finger.
    assert.match(boundaryProblem(SQUARE.slice(0, 2)), /[Dd]rag|[Dd]raw/);
    assert.equal(boundaryProblem(SQUARE.slice(0, MIN_VERTICES - 1)) !== null, true);
  });

  test("a shape too small to hold a house is refused", () => {
    const pinprick = [
      { lat: 38.4, lng: -85.38 },
      { lat: 38.40001, lng: -85.38 },
      { lat: 38.40001, lng: -85.37999 },
    ];
    assert.match(boundaryProblem(pinprick), /too small/);
  });

  test("a real shape has nothing wrong with it", () => {
    assert.equal(boundaryProblem(SQUARE), null);
    assert.equal(boundaryProblem(CONCAVE), null);
  });
});

describe("how far through one you are", () => {
  const pin = (lastContactedAt, status = "lead") => ({ lastContactedAt, status });

  test("counts doors spoken to, not doors ticked", () => {
    const coverage = coverageOf([pin("yesterday"), pin(null), pin(null), pin("today", "customer")]);
    assert.equal(coverage.total, 4);
    assert.equal(coverage.unknocked, 2);
    assert.equal(coverage.won, 1);
    assert.equal(coverage.fraction, 0.5);
  });

  test("an empty territory is zero, not complete", () => {
    const coverage = coverageOf([]);
    assert.equal(coverage.fraction, 0);
    assert.equal(coverage.total, 0);
  });

  test("every door knocked reads as finished", () => {
    assert.equal(coverageOf([pin("a"), pin("b")]).fraction, 1);
  });
});

/* ---------------------------------------------------- freehand simplifying */

describe("thinning out a freehand drag", () => {
  /** A straight run of points, every one of them redundant. */
  const straight = Array.from({ length: 200 }, (_, i) => ({ x: i, y: 0 }));

  test("a straight line collapses to its two ends", () => {
    const out = simplifyPath(straight, SIMPLIFY_TOLERANCE);
    assert.deepEqual(out, [
      { x: 0, y: 0 },
      { x: 199, y: 0 },
    ]);
  });

  test("a corner survives", () => {
    // The whole job: drop the points that carry no shape, keep the ones that
    // do. A territory follows streets, so the corners *are* the territory.
    const out = simplifyPath(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
      ],
      SIMPLIFY_TOLERANCE,
    );
    assert.deepEqual(out, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  test("jitter below the tolerance is wobble, not shape", () => {
    // A hand shaking by a pixel while dragging along a street. Keeping it would
    // store a thousand vertices describing somebody's grip.
    const shaky = straight.map((p, i) => ({ x: p.x, y: i % 2 === 0 ? 1 : -1 }));
    assert.ok(simplifyPath(shaky, SIMPLIFY_TOLERANCE).length <= 4);
  });

  test("a deliberate detour bigger than the tolerance is kept", () => {
    const withBump = [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 0 },
    ];
    assert.equal(simplifyPath(withBump, SIMPLIFY_TOLERANCE).length, 3);
  });

  test("the ends are never dropped", () => {
    const out = simplifyPath(straight, 10_000);
    assert.deepEqual(out[0], { x: 0, y: 0 });
    assert.deepEqual(out.at(-1), { x: 199, y: 0 });
  });

  test("short paths pass through untouched", () => {
    assert.deepEqual(simplifyPath([], 3), []);
    assert.deepEqual(simplifyPath([{ x: 1, y: 2 }], 3), [{ x: 1, y: 2 }]);
  });

  test("repeated identical points do not produce NaN", () => {
    // A finger held still samples the same pixel many times. The segment
    // between two identical points has zero length, and the obvious
    // perpendicular-distance formula divides by zero there — every distance
    // comes back NaN, compares false, and the shape silently collapses.
    const stuck = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 60 },
      { x: 5, y: 5 },
    ];
    const out = simplifyPath(stuck, SIMPLIFY_TOLERANCE);
    assert.ok(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    assert.ok(
      out.some((p) => p.y === 60),
      "the one point that carries shape must survive",
    );
  });
});

describe("keeping a drag under the vertex ceiling", () => {
  /**
   * A big loop with a fine ripple riding on it — a hand that shook while
   * dragging around a subdivision. Both scales are real at 3px, which is
   * exactly the case the ceiling exists for: a smooth circle simplifies to
   * about 25 points on its own and would never reach it.
   */
  const rippled = Array.from({ length: 1000 }, (_, i) => {
    const angle = (i / 1000) * Math.PI * 2;
    const radius = 400 + Math.sin(i * ((Math.PI * 2) / 10)) * 6;
    return { x: 500 + Math.cos(angle) * radius, y: 500 + Math.sin(angle) * radius };
  });

  test("one pass at the drawing tolerance is not enough", () => {
    // If it were, the loosening loop would be dead code and this test would be
    // the thing that noticed.
    assert.ok(simplifyPath(rippled, SIMPLIFY_TOLERANCE).length > MAX_VERTICES);
  });

  test("loosening brings it under the ceiling", () => {
    const out = simplifyToLimit(rippled);
    assert.ok(out.length <= MAX_VERTICES, `got ${out.length}`);
    // The ripple goes and the loop stays: it is still recognisably a loop
    // rather than the triangle a runaway tolerance would leave.
    assert.ok(out.length > 8, `over-simplified to ${out.length}`);
  });

  test("a shape already small enough is left alone", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    assert.deepEqual(simplifyToLimit(square), square);
  });
});

describe("telling a tap from a drag", () => {
  test("a still finger is a tap", () => {
    assert.equal(isTap([{ x: 100, y: 100 }]), true);
    assert.equal(dragSpread([{ x: 100, y: 100 }]), 0);
  });

  test("a shaky tap is still a tap", () => {
    // Nobody holds a phone still. Reading a two-pixel wobble as a drag turns a
    // deliberate corner into a three-point polygon the size of a doormat.
    const wobble = [
      { x: 100, y: 100 },
      { x: 101, y: 99 },
      { x: 102, y: 101 },
      { x: 100, y: 100 },
    ];
    assert.equal(isTap(wobble), true);
  });

  test("a real drag is a drag", () => {
    const drag = [
      { x: 100, y: 100 },
      { x: 160, y: 140 },
      { x: 200, y: 240 },
    ];
    assert.equal(isTap(drag), false);
  });

  test("spread is measured from the start, not end to end", () => {
    // A loop finishes where it began. Comparing first to last would call every
    // closed shape — which is every territory — a tap.
    const loop = [
      { x: 0, y: 0 },
      { x: 0, y: 300 },
      { x: 300, y: 300 },
      { x: 0, y: 0 },
    ];
    assert.ok(dragSpread(loop) > TAP_SLOP);
    assert.equal(isTap(loop), false);
  });

  test("nothing at all is a tap, not a crash", () => {
    assert.equal(dragSpread([]), 0);
    assert.equal(isTap([]), true);
  });
});
