/** Job checklists: templates, ticking, adding, and reading bad data. */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  templateSteps,
  fromSteps,
  asChecklist,
  toggleItem,
  addItem,
  removeItem,
  progress,
  openSteps,
  MAX_ITEMS,
} = await import("../lib/checklists.ts");

let n = 0;
const ids = () => `i${++n}`;

describe("the usual list", () => {
  test("a pressure-washing job gets the washing steps", () => {
    const steps = templateSteps({ serviceTypes: ["pressure_washing"] });
    assert.ok(steps.includes("Cover outlets, lights and plants"));
    assert.equal(steps.at(-1), "After photos");
  });

  test("two services merge, shared steps once, photos still last", () => {
    const steps = templateSteps({ serviceTypes: ["pressure_washing", "landscaping"] });
    assert.equal(steps.filter((s) => s === "Before photos").length, 1);
    assert.equal(steps.filter((s) => s === "After photos").length, 1);
    assert.ok(steps.includes("Edge beds and walks"));
    assert.equal(steps.at(-1), "After photos");
    assert.ok(steps.indexOf("Haul away debris") > steps.indexOf("Edge beds and walks"));
  });

  test("an estimate visit gets the estimate list, not the work", () => {
    const steps = templateSteps({ serviceTypes: ["pressure_washing"], visitType: "estimate" });
    assert.ok(steps.includes("Measure the areas"));
    assert.ok(!steps.includes("Pre-treat stains"));
  });

  test("no service at all still gets a list", () => {
    assert.ok(templateSteps({ serviceTypes: [] }).length > 0);
  });

  test("items start unticked with unique ids", () => {
    const list = fromSteps(["A", "B"], ids);
    assert.equal(new Set(list.map((i) => i.id)).size, 2);
    assert.ok(list.every((i) => !i.done && i.doneBy === null));
  });
});

describe("ticking", () => {
  test("tick stamps who and when; untick clears both", () => {
    const list = fromSteps(["A", "B"], ids);
    const ticked = toggleItem(list, list[0].id, "bob", 1000);
    assert.deepEqual([ticked[0].done, ticked[0].doneBy, ticked[0].doneAt], [true, "bob", 1000]);
    assert.equal(ticked[1].done, false);
    const back = toggleItem(ticked, list[0].id, "alice", 2000);
    assert.deepEqual([back[0].done, back[0].doneBy, back[0].doneAt], [false, null, null]);
  });

  test("progress and what is still open", () => {
    const list = fromSteps(["A", "B", "C"], ids);
    const ticked = toggleItem(list, list[1].id, "bob", 1);
    assert.deepEqual(progress(ticked), { done: 1, total: 3 });
    assert.deepEqual(openSteps(ticked), ["A", "C"]);
  });
});

describe("editing the list", () => {
  test("adds a trimmed item, ignores a blank one", () => {
    const list = addItem([], "  Check the gate  ", ids);
    assert.equal(list[0].text, "Check the gate");
    assert.equal(addItem(list, "   ", ids).length, 1);
  });

  test("stops at the cap", () => {
    let list = [];
    for (let i = 0; i < MAX_ITEMS + 5; i += 1) list = addItem(list, `Step ${i}`, ids);
    assert.equal(list.length, MAX_ITEMS);
  });

  test("removes by id", () => {
    const list = fromSteps(["A", "B"], ids);
    assert.deepEqual(removeItem(list, list[0].id).map((i) => i.text), ["B"]);
  });
});

describe("reading what is stored", () => {
  test("drops junk, duplicates and blanks; clears stamps on undone items", () => {
    const read = asChecklist([
      { id: "a", text: "Walk it", done: true, doneBy: "bob", doneAt: 5 },
      { id: "a", text: "Duplicate id", done: false },
      { id: "b", text: "   " },
      { text: "No id" },
      "a string",
      null,
      { id: "c", text: "Open", done: false, doneBy: "bob", doneAt: 7 },
    ]);
    assert.deepEqual(read.map((i) => i.id), ["a", "c"]);
    assert.equal(read[0].doneBy, "bob");
    assert.equal(read[1].doneBy, null);
    assert.equal(read[1].doneAt, null);
  });

  test("anything that is not a list is an empty list", () => {
    assert.deepEqual(asChecklist(undefined), []);
    assert.deepEqual(asChecklist("nope"), []);
  });
});
