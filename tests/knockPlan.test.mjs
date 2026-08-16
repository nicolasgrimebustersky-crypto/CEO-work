/**
 * Tests for the door-knocking route planner.
 *
 * The ordering is the part of this feature that is worth anything: a list of
 * forty addresses in the order they happened to be added is a wasted afternoon,
 * and the difference between a good order and a bad one is not visible by
 * reading either of them. So it is measured here rather than eyeballed.
 *
 * Progress is the other half, and it has a specific failure worth pinning: a
 * stop removed from the route after somebody knocked it must not push the count
 * past 100%, which is what happens if you trust the knocked list's own length.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  MINUTES_PER_DOOR,
  estimateRouteMinutes,
  formatMinutes,
  metersBetween,
  nextStop,
  orderByNearest,
  routeMeters,
  routeProgress,
} = await import("../lib/knock/plan.ts");

/** Four houses on a rough square, ~1km apart, plus one far away. */
const A = { id: "a", lat: 38.4076, lng: -85.3791 };
const B = { id: "b", lat: 38.4076, lng: -85.3691 };
const C = { id: "c", lat: 38.4166, lng: -85.3691 };
const D = { id: "d", lat: 38.4166, lng: -85.3791 };
const FAR = { id: "far", lat: 38.3103, lng: -85.4783 };

describe("distance", () => {
  test("a degree of latitude is about 111km", () => {
    const meters = metersBetween({ lat: 38, lng: -85 }, { lat: 39, lng: -85 });
    assert.ok(Math.abs(meters - 111_195) < 500, `got ${Math.round(meters)}m`);
  });

  test("the same point is zero away from itself", () => {
    assert.equal(metersBetween(A, { lat: A.lat, lng: A.lng }), 0);
  });
});

describe("ordering a route", () => {
  test("walks the square instead of criss-crossing it", () => {
    // Fed in deliberately across the diagonal: A, C, B, D. A route that keeps
    // that order drives the diagonal twice.
    const ordered = orderByNearest([A, C, B, D], A);
    assert.deepEqual(
      ordered.map((s) => s.id),
      ["a", "b", "c", "d"],
    );
  });

  test("it is genuinely shorter than the order it was given", () => {
    const given = [A, C, B, D];
    const ordered = orderByNearest(given, A);
    assert.ok(
      routeMeters(ordered, A) < routeMeters(given, A),
      "the planner made the route longer",
    );
  });

  test("leaves the far stop until last", () => {
    const ordered = orderByNearest([FAR, A, B], A);
    assert.equal(ordered[ordered.length - 1].id, "far");
  });

  test("starts from where you actually are", () => {
    // Standing next to D, the first door should be D — not whatever happens to
    // be first in the list.
    assert.equal(orderByNearest([A, B, C, D], D)[0].id, "d");
    assert.equal(orderByNearest([A, B, C, D], B)[0].id, "b");
  });

  test("plans the same route the same way twice", () => {
    // Ties break towards the earlier stop, so the list does not reshuffle under
    // somebody's thumb when two doors are equidistant.
    const twin = { id: "twin", lat: B.lat, lng: B.lng };
    const first = orderByNearest([A, B, twin], A).map((s) => s.id);
    const second = orderByNearest([A, B, twin], A).map((s) => s.id);
    assert.deepEqual(first, second);
    assert.deepEqual(first, ["a", "b", "twin"]);
  });

  test("keeps every stop, exactly once", () => {
    const ordered = orderByNearest([A, C, B, D, FAR], null);
    assert.equal(ordered.length, 5);
    assert.equal(new Set(ordered.map((s) => s.id)).size, 5);
  });

  test("copes with nothing, and with one", () => {
    assert.deepEqual(orderByNearest([], A), []);
    assert.deepEqual(
      orderByNearest([A], null).map((s) => s.id),
      ["a"],
    );
  });

  test("with no GPS fix it still returns a stable order", () => {
    const ordered = orderByNearest([C, A, B], null);
    assert.equal(ordered[0].id, "c", "anchors on the first stop given");
    assert.deepEqual(ordered.map((s) => s.id), orderByNearest([C, A, B], null).map((s) => s.id));
  });
});

describe("how long it will take", () => {
  test("knocking dominates a tight route", () => {
    // Four doors a kilometre apart: the driving is minutes, the doors are most
    // of the afternoon. If this inverts, the estimate is wrong somewhere.
    const minutes = estimateRouteMinutes([A, B, C, D], A);
    assert.ok(minutes >= 4 * MINUTES_PER_DOOR, `got ${minutes}m`);
    assert.ok(minutes < 4 * MINUTES_PER_DOOR + 30, `got ${minutes}m`);
  });

  test("a far-flung route costs more than a tight one", () => {
    const tight = estimateRouteMinutes([A, B, C], A);
    const spread = estimateRouteMinutes([A, B, FAR], A);
    assert.ok(spread > tight);
  });

  test("no stops is no time", () => {
    assert.equal(estimateRouteMinutes([], A), 0);
    assert.equal(routeMeters([], A), 0);
  });

  test("reads as a clock", () => {
    assert.equal(formatMinutes(45), "45m");
    assert.equal(formatMinutes(60), "1h");
    assert.equal(formatMinutes(80), "1h 20m");
  });
});

describe("progress through a route", () => {
  const stops = ["a", "b", "c", "d"];

  test("counts what has been knocked", () => {
    const progress = routeProgress(stops, ["a", "b"]);
    assert.equal(progress.knocked, 2);
    assert.equal(progress.remaining, 2);
    assert.equal(progress.fraction, 0.5);
    assert.equal(progress.done, false);
  });

  test("every door knocked reads as done", () => {
    assert.equal(routeProgress(stops, stops).done, true);
    assert.equal(routeProgress(stops, stops).fraction, 1);
  });

  test("a knocked door removed from the route cannot push it past complete", () => {
    // The specific bug this guards: trusting knockedIds.length would report
    // five of four doors knocked, and a progress bar over 100%.
    const progress = routeProgress(stops, ["a", "b", "c", "d", "deleted-stop"]);
    assert.equal(progress.knocked, 4);
    assert.equal(progress.fraction, 1);
  });

  test("an empty route is not silently complete", () => {
    const progress = routeProgress([], []);
    assert.equal(progress.fraction, 0);
    assert.equal(progress.done, false, "nothing to do is not the same as done");
  });
});

describe("which door is next", () => {
  test("the first one in order that has not been knocked", () => {
    assert.equal(nextStop([A, B, C, D], ["a"])?.id, "b");
    assert.equal(nextStop([A, B, C, D], ["a", "b", "c"])?.id, "d");
  });

  test("order wins over the knocked list's order", () => {
    // Knocked out of sequence — doubled back for C first. Next is still B.
    assert.equal(nextStop([A, B, C, D], ["a", "c"])?.id, "b");
  });

  test("nothing left to knock", () => {
    assert.equal(nextStop([A, B], ["a", "b"]), null);
    assert.equal(nextStop([], []), null);
  });
});
