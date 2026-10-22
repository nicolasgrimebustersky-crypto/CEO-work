/**
 * Picking several services, and the specific ones under each.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { SUB_SERVICES, MAIN_SERVICES, subServicesFor, cleanSelection, toggleMain, toggleSub, describeSelection } =
  await import("../lib/subServices.ts");

const LABEL = { pressure_washing: "Pressure washing", landscaping: "Landscaping", snow_removal: "Snow removal" };
const label = (main) => LABEL[main];

describe("the catalogue", () => {
  test("mulching exists, under landscaping", () => {
    assert.ok(subServicesFor("landscaping").some((sub) => sub.key === "mulching" && sub.label === "Mulching"));
  });

  test("every specific service belongs to one of the three, and keys are unique", () => {
    const keys = new Set();
    for (const sub of SUB_SERVICES) {
      assert.ok(MAIN_SERVICES.includes(sub.main), sub.key);
      assert.ok(!keys.has(sub.key), `duplicate ${sub.key}`);
      keys.add(sub.key);
    }
    for (const main of MAIN_SERVICES) assert.ok(subServicesFor(main).length >= 3, main);
  });
});

describe("cleaning a selection", () => {
  test("a record saved before this reads as just its one service", () => {
    assert.deepEqual(cleanSelection({}, "landscaping"), { serviceTypes: ["landscaping"], subServices: [] });
  });

  test("unknown and duplicate values are dropped", () => {
    const out = cleanSelection(
      { serviceTypes: ["landscaping", "landscaping", "car_wash", 7], subServices: ["mulching", "mulching", "nope"] },
      "pressure_washing",
    );
    assert.deepEqual(out, { serviceTypes: ["landscaping"], subServices: ["mulching"] });
  });

  test("a specific service whose main one is not picked is dropped", () => {
    const out = cleanSelection({ serviceTypes: ["pressure_washing"], subServices: ["mulching", "driveway"] }, "pressure_washing");
    assert.deepEqual(out.subServices, ["driveway"]);
  });

  test("garbage falls back to the record's own service, never to nothing", () => {
    assert.deepEqual(cleanSelection({ serviceTypes: "landscaping", subServices: {} }, "snow_removal").serviceTypes, [
      "snow_removal",
    ]);
  });
});

describe("toggling", () => {
  const start = { serviceTypes: ["pressure_washing"], subServices: [] };

  test("several main services can be picked at once", () => {
    const both = toggleMain(start, "landscaping");
    assert.deepEqual(both.serviceTypes, ["pressure_washing", "landscaping"]);
  });

  test("the last main service cannot be turned off", () => {
    assert.deepEqual(toggleMain(start, "pressure_washing"), start);
  });

  test("turning a main service off takes its specific services with it", () => {
    let sel = toggleMain(start, "landscaping");
    sel = toggleSub(sel, "mulching");
    sel = toggleSub(sel, "house_wash");
    sel = toggleMain(sel, "landscaping");
    assert.deepEqual(sel, { serviceTypes: ["pressure_washing"], subServices: ["house_wash"] });
  });

  test("specific services toggle on and off, several at once", () => {
    let sel = toggleSub(start, "driveway");
    sel = toggleSub(sel, "walkway");
    assert.deepEqual(sel.subServices, ["driveway", "walkway"]);
    assert.deepEqual(toggleSub(sel, "driveway").subServices, ["walkway"]);
  });
});

describe("in words", () => {
  test("just the main service when nothing specific is picked", () => {
    assert.equal(describeSelection({ serviceTypes: ["pressure_washing"], subServices: [] }, label), "Pressure washing");
  });

  test("the specific services, listed naturally", () => {
    const sel = { serviceTypes: ["pressure_washing", "landscaping"], subServices: ["house_wash", "driveway", "mulching"] };
    assert.equal(describeSelection(sel, label), "House & siding wash, Driveway & concrete and Mulching");
  });

  test("a main service with nothing specific under it is still named", () => {
    const sel = { serviceTypes: ["pressure_washing", "landscaping"], subServices: ["driveway"] };
    assert.equal(describeSelection(sel, label), "Driveway & concrete and Landscaping");
  });
});
