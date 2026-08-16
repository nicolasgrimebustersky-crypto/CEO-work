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
  MIN_VERTICES,
  acresOf,
  boundaryProblem,
  boundsOf,
  centroidOf,
  coverageOf,
  formatAcres,
  isInside,
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
    const problem = boundaryProblem(SQUARE.slice(0, 2));
    assert.match(problem, new RegExp(String(MIN_VERTICES)));
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
