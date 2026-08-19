/**
 * Turning a spoken job description and a price into estimate line items.
 *
 * Almost everything here defends one property: the number the operator typed is
 * the number on the estimate. A model that writes good wording and quietly
 * returns $437 for a $450 job produces a document that is wrong in the one way
 * nobody proofreads for, because the words look right. So the model is never
 * allowed to touch the money — it returns a split, and the arithmetic below
 * turns that into dollars.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  ALLOWED_IMAGE_TYPES,
  MAX_DESCRIPTION,
  MAX_PHOTOS,
  draftProblem,
  fitWithin,
  isAllowedImageType,
  itemsTotal,
  priceItems,
  subtotalForTotal,
  usableItems,
} = await import("../lib/estimateDraft.ts");

// The builder's own arithmetic, imported rather than reimplemented — a copy
// here would drift and the round-trip below would then prove nothing.
const { computeTotals } = await import("../lib/documents.ts");

const ok = { description: "Driveway and back patio", total: 450, serviceType: "pressure_washing" };

/* ------------------------------------------------ the money is not the model's */

describe("the total is exactly what was typed in", () => {
  const cases = [
    ["an even split of an odd number", [0.5, 0.5], 333.33],
    ["three ways, which never divides", [1, 1, 1], 100],
    ["a lopsided split", [0.7, 0.2, 0.1], 1275.55],
    ["one line", [1], 450],
    ["shares that do not sum to 1", [3, 1], 800],
    ["shares that sum well over 1", [80, 20], 640.99],
    ["a cent", [1, 1], 0.01],
  ];

  for (const [label, shares, total] of cases) {
    test(label, () => {
      const items = shares.map((share, i) => ({
        name: `Part ${i + 1}`,
        description: "",
        share,
      }));
      const priced = priceItems(items, total);
      assert.equal(
        itemsTotal(priced),
        total,
        `${priced.map((p) => p.unitPrice).join(" + ")} !== ${total}`,
      );
    });
  }

  test("no line is ever negative", () => {
    // A negative unit price on an estimate is indefensible whatever the cause,
    // so it is refused structurally rather than reasoned about.
    const priced = priceItems(
      [
        { name: "a", description: "", share: 0.999 },
        { name: "b", description: "", share: 0.001 },
      ],
      0.02,
    );
    for (const item of priced) assert.ok(item.unitPrice >= 0, JSON.stringify(item));
  });

  test("the residue lands on the biggest line, not a trivial one", () => {
    // A stray cent on a $2 line reads as a mistake. On a $300 line nobody
    // notices, and nobody is wrong.
    const priced = priceItems(
      [
        { name: "big", description: "", share: 2 / 3 },
        { name: "small", description: "", share: 1 / 3 },
      ],
      100,
    );
    const big = priced.find((p) => p.name === "big");
    const small = priced.find((p) => p.name === "small");
    assert.equal(itemsTotal(priced), 100);
    assert.equal(small.unitPrice, 33.33);
    assert.equal(big.unitPrice, 66.67);
  });

  test("no opinion about the split means an even one", () => {
    // All-zero shares is the model saying it does not know. Splitting evenly is
    // the honest reading; treating zero as "this line is free" is not.
    const priced = priceItems(
      [
        { name: "a", description: "", share: 0 },
        { name: "b", description: "", share: 0 },
        { name: "c", description: "", share: 0 },
      ],
      90,
    );
    assert.deepEqual(priced.map((p) => p.unitPrice), [30, 30, 30]);
    assert.equal(itemsTotal(priced), 90);
  });

  test("nothing in, nothing out", () => {
    assert.deepEqual(priceItems([], 450), []);
    assert.deepEqual(priceItems([{ name: "a", description: "", share: 1 }], 0), []);
    assert.deepEqual(priceItems([{ name: "a", description: "", share: 1 }], -5), []);
  });

  test("every line is quantity 1", () => {
    // These are flat-price lines. Quantity exists for hours and square feet,
    // which a drafted estimate has no basis to invent.
    const priced = priceItems([{ name: "a", description: "", share: 1 }], 200);
    assert.equal(priced[0].quantity, 1);
  });
});

/* ------------------------------------------------------ the model's output */

describe("what comes back from the model", () => {
  test("keeps the good lines and drops the junk", () => {
    // Losing three good lines because a fourth was malformed would be a worse
    // outcome than dropping the fourth.
    const items = usableItems([
      { name: "House wash", description: "Two storeys, soft wash", share: 0.6 },
      null,
      "not an object",
      { name: "", description: "", share: 0.2 },
      { name: "Driveway", description: "", share: 0.4 },
    ]);
    assert.deepEqual(items.map((i) => i.name), ["House wash", "Driveway"]);
  });

  test("a description with no name still becomes a line", () => {
    const items = usableItems([{ description: "Cleared the side yard" }]);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "Cleared the side yard");
  });

  test("a share that is not a number does not poison the arithmetic", () => {
    const items = usableItems([
      { name: "a", share: "0.5" },
      { name: "b", share: NaN },
      { name: "c", share: -3 },
    ]);
    assert.deepEqual(items.map((i) => i.share), [0, 0, 0]);
    const priced = priceItems(items, 300);
    assert.equal(itemsTotal(priced), 300);
  });

  test("garbage instead of a list is not a draft", () => {
    for (const junk of [null, undefined, {}, "items", 42]) {
      assert.deepEqual(usableItems(junk), []);
    }
  });

  test("whitespace-only fields are not content", () => {
    assert.deepEqual(usableItems([{ name: "   ", description: "  " }]), []);
  });
});

/* ------------------------------------------------------ refusing to draft */

describe("when it will not draft at all", () => {
  test("a normal ask is fine", () => {
    assert.equal(draftProblem(ok), null);
  });

  test("no description", () => {
    assert.match(draftProblem({ ...ok, description: "  " }), /what the job is/i);
  });

  test("no price, or a nonsense one", () => {
    // A $0 estimate sent to a customer is worse than no estimate at all.
    for (const total of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.match(draftProblem({ ...ok, total }), /charging/i, `total ${total}`);
    }
  });

  test("a price with too many zeros is caught before it is sent", () => {
    assert.match(draftProblem({ ...ok, total: 45_000_000 }), /typo/i);
  });

  test("an essay", () => {
    const problem = draftProblem({ ...ok, description: "x".repeat(MAX_DESCRIPTION + 1) });
    assert.match(problem, new RegExp(String(MAX_DESCRIPTION)));
  });

  test("too many photos", () => {
    assert.equal(draftProblem({ ...ok, photoCount: MAX_PHOTOS }), null);
    assert.match(draftProblem({ ...ok, photoCount: MAX_PHOTOS + 1 }), /photos/i);
  });
});

/* -------------------------------------------------------------- the photos */

describe("photos", () => {
  test("only formats the API actually accepts", () => {
    for (const type of ALLOWED_IMAGE_TYPES) assert.equal(isAllowedImageType(type), true);
    // HEIC is what an iPhone shoots by default and the API does not take it —
    // the browser converts during downscaling, so it must never be sent raw.
    for (const type of ["image/heic", "application/pdf", "text/plain", "", null, undefined]) {
      assert.equal(isAllowedImageType(type), false, String(type));
    }
  });

  test("a big photo is shrunk on its longest edge, keeping its shape", () => {
    const shrunk = fitWithin(4032, 3024, 1024);
    assert.equal(shrunk.width, 1024);
    assert.equal(shrunk.height, 768);
    assert.ok(Math.abs(shrunk.width / shrunk.height - 4032 / 3024) < 0.01);
  });

  test("portrait shrinks on height", () => {
    const shrunk = fitWithin(3024, 4032, 1024);
    assert.equal(shrunk.height, 1024);
    assert.equal(shrunk.width, 768);
  });

  test("a small photo is left alone rather than blown up", () => {
    // Enlarging adds bytes and no detail — a slower upload for nothing.
    assert.deepEqual(fitWithin(640, 480, 1024), { width: 640, height: 480 });
  });

  test("nonsense dimensions do not produce a canvas of NaN", () => {
    for (const [w, h] of [[0, 100], [100, 0], [-5, 5], [Number.NaN, 10]]) {
      const out = fitWithin(w, h, 1024);
      assert.ok(Number.isFinite(out.width) && Number.isFinite(out.height), `${w}x${h}`);
    }
  });
});

/* ------------------------------------------- the number the customer pays */

describe("the price typed in is what the document totals", () => {
  // Found by driving the built app, not by these tests: lines summing to $450
  // produced a $477 estimate, because Kentucky sales tax is added on top. The
  // number said out loud in a driveway is what the customer pays.
  const asLines = (priced) =>
    priced.map((item, i) => ({
      id: String(i),
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxable: true,
    }));

  const roundTrip = (total, taxRatePct, shares, discount = 0) => {
    const subtotal = subtotalForTotal(total, taxRatePct, discount);
    const priced = priceItems(
      shares.map((share, i) => ({ name: `Part ${i + 1}`, description: "", share })),
      subtotal,
    );
    return computeTotals(asLines(priced), discount, taxRatePct);
  };

  const cases = [
    ["$450 at 6% — the case the browser caught", 450, 6, [1]],
    ["split three ways at 6%", 450, 6, [0.5, 0.3, 0.2]],
    ["an awkward total", 1275.55, 6, [0.7, 0.3]],
    ["no tax at all", 450, 0, [1, 1]],
    ["a round number that divides badly", 100, 6, [1, 1, 1]],
    ["a big job", 12500, 6, [0.4, 0.35, 0.25]],
    ["a small one", 45, 6, [1]],
    ["with a discount", 500, 6, [0.6, 0.4], 50],
  ];

  for (const [label, total, rate, shares, discount] of cases) {
    test(label, () => {
      const totals = roundTrip(total, rate, shares, discount ?? 0);
      assert.equal(
        totals.total,
        total,
        `document totalled ${totals.total}, operator said ${total}`,
      );
    });
  }

  test("the subtotal is genuinely below the total when tax applies", () => {
    // Guards the inversion being dropped: returning the total unchanged would
    // pass nothing above except the zero-tax case.
    assert.ok(subtotalForTotal(450, 6) < 450);
    assert.equal(subtotalForTotal(450, 0), 450);
  });

  test("nonsense in, zero out", () => {
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(subtotalForTotal(bad, 6), 0, String(bad));
    }
  });

  test("a nonsense tax rate does not produce a nonsense subtotal", () => {
    assert.equal(subtotalForTotal(450, Number.NaN), 450);
    assert.equal(subtotalForTotal(450, -6), 450);
  });
});
