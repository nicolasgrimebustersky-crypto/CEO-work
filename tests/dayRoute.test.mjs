/**
 * The day's driving order. Pinned: it starts where it is told to, it never
 * returns something slower than the schedule's own order, it finds the
 * obvious best order on simple layouts, and the re-timed schedule adds up.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { planRoute, routeMinutes, estimateMatrix, retime, googleRouteUrl, hasFix } = await import(
  "../lib/dayRoute.ts"
);

// A line of houses running east, about 0.7 miles apart.
const at = (i) => ({ lat: 38.4, lng: -85.4 + i * 0.013 });
const stop = (id, i) => ({ id, ...at(i) });

/** Every order of the stops, for checking small cases against the true best. */
function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

describe("planning the order", () => {
  test("a jumbled street is driven end to end from where you stand", () => {
    const stops = [stop("c", 3), stop("a", 1), stop("e", 5), stop("b", 2), stop("d", 4)];
    const plan = planRoute(at(0), stops);
    assert.deepEqual(plan.order, ["a", "b", "c", "d", "e"]);
    assert.ok(plan.minutes < plan.givenMinutes);
  });

  test("starting at the far end drives the street the other way", () => {
    const stops = [stop("a", 1), stop("b", 2), stop("c", 3)];
    assert.deepEqual(planRoute(at(4), stops).order, ["c", "b", "a"]);
  });

  test("never slower than the schedule's order", () => {
    const stops = [stop("a", 1), stop("b", 2), stop("c", 3)];
    const plan = planRoute(at(0), stops);
    assert.deepEqual(plan.order, ["a", "b", "c"]);
    assert.ok(plan.minutes <= plan.givenMinutes + 1e-9);
  });

  test("matches the true best order on scattered jobs", () => {
    const pts = [
      { id: "p1", lat: 38.41, lng: -85.31 },
      { id: "p2", lat: 38.35, lng: -85.45 },
      { id: "p3", lat: 38.47, lng: -85.38 },
      { id: "p4", lat: 38.39, lng: -85.52 },
      { id: "p5", lat: 38.44, lng: -85.42 },
      { id: "p6", lat: 38.33, lng: -85.36 },
      { id: "p7", lat: 38.5, lng: -85.47 },
    ];
    const start = { lat: 38.4, lng: -85.4 };
    const matrix = estimateMatrix(start, pts);
    const plan = planRoute(start, pts, matrix);
    const best = Math.min(...permutations([1, 2, 3, 4, 5, 6, 7]).map((o) => routeMinutes(o, matrix)));
    assert.ok(plan.minutes <= best * 1.03, `${plan.minutes} vs best ${best}`);
  });

  test("uses road times when given — a slow road changes the order", () => {
    const stops = [stop("a", 1), stop("b", 2)];
    // Start → a is quick on the map but there is no road: 60 minutes round.
    const matrix = [
      [0, 60, 5],
      [60, 0, 5],
      [5, 5, 0],
    ];
    assert.deepEqual(planRoute(at(0), stops, matrix).order, ["b", "a"]);
  });

  test("a wrongly sized matrix is ignored rather than trusted", () => {
    const stops = [stop("b", 2), stop("a", 1)];
    assert.deepEqual(planRoute(at(0), stops, [[0]]).order, ["a", "b"]);
  });

  test("jobs with no map location go last, flagged", () => {
    const stops = [{ id: "x", lat: 0, lng: 0 }, stop("a", 1), stop("b", 2)];
    const plan = planRoute(at(0), stops);
    assert.deepEqual(plan.order, ["a", "b", "x"]);
    assert.deepEqual(plan.unplaced, ["x"]);
    assert.equal(hasFix({ lat: 0, lng: 0 }), false);
  });

  test("one job or none", () => {
    assert.deepEqual(planRoute(at(0), []).order, []);
    assert.deepEqual(planRoute(at(0), [stop("a", 1)]).order, ["a"]);
  });
});

describe("re-timing the day", () => {
  test("each visit starts when the last ends plus the drive, on a 5-minute mark", () => {
    const first = new Date(2026, 5, 2, 9, 0);
    const times = retime(
      [
        { id: "a", durationMinutes: 45 },
        { id: "b", durationMinutes: 30 },
        { id: "c", durationMinutes: 60 },
      ],
      [0, 12, 3],
      first,
    );
    assert.deepEqual(
      times.map((t) => [t.id, t.start.getHours(), t.start.getMinutes(), t.end.getHours(), t.end.getMinutes()]),
      [
        ["a", 9, 0, 9, 45],
        ["b", 10, 0, 10, 30], // 9:45 + 12 = 9:57 → 10:00
        ["c", 10, 35, 11, 35], // 10:30 + 3 = 10:33 → 10:35
      ],
    );
  });
});

describe("the Google Maps link", () => {
  test("from the start, through the stops, to the last", () => {
    const url = new URL(googleRouteUrl(at(0), [at(1), at(2), at(3)]));
    assert.equal(url.searchParams.get("origin"), "38.400000,-85.400000");
    assert.equal(url.searchParams.get("destination"), "38.400000,-85.361000");
    assert.equal(url.searchParams.get("waypoints").split("|").length, 2);
    assert.equal(url.searchParams.get("travelmode"), "driving");
  });

  test("no start means the phone's own location; no stops means no link", () => {
    assert.equal(new URL(googleRouteUrl(null, [at(1)])).searchParams.has("origin"), false);
    assert.equal(googleRouteUrl(at(0), []), null);
  });

  test("caps at ten stops, Google's limit for a link", () => {
    const url = new URL(googleRouteUrl(at(0), Array.from({ length: 14 }, (_, i) => at(i + 1))));
    assert.equal(url.searchParams.get("waypoints").split("|").length, 9);
  });
});
