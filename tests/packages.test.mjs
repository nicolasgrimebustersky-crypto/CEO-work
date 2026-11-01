/**
 * Good / Better / Best estimates. The rule that matters most: the customer
 * sends only a package id, and every price is read from the stored estimate.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  defaultPackages,
  pricePackages,
  storedTotals,
  choosePackage,
  packagesProblem,
  tidyLines,
} = await import("../lib/packages.ts");

const line = (id, unitPrice, pkg) => ({
  id,
  name: id,
  description: "",
  quantity: 1,
  unitPrice,
  taxable: false,
  ...(pkg ? { package: pkg } : {}),
});

const PACKAGES = defaultPackages();
const LINES = [
  line("house wash", 300),
  line("windows", 100, "pkg2"),
  line("windows", 100, "pkg3"),
  line("gutters", 150, "pkg3"),
  line("driveway", 50, "pkg1"),
];

describe("pricing the packages", () => {
  test("each package is the shared work plus its own lines", () => {
    const priced = pricePackages(LINES, PACKAGES, 0, 0);
    assert.deepEqual(priced.map((p) => [p.pkg.name, p.totals.total]), [
      ["Good", 350],
      ["Better", 400],
      ["Best", 550],
    ]);
    assert.deepEqual(priced[2].ownLines.map((l) => l.id), ["windows", "gutters"]);
  });

  test("the estimate's discount and tax apply to each package as to any document", () => {
    const taxed = [line("wash", 100), line("extra", 100, "pkg2")].map((l) => ({ ...l, taxable: true }));
    const [good, better] = pricePackages(taxed, PACKAGES.slice(0, 2), 10, 6);
    assert.equal(good.totals.total, 95.4);
    assert.equal(better.totals.total, 201.4);
  });

  test("until the customer chooses, the stored price is the first package's", () => {
    assert.equal(storedTotals(LINES, PACKAGES, 0, 0).total, 350);
    assert.equal(storedTotals(LINES, [], 0, 0).total, 700, "no packages: every line, as before");
  });
});

describe("the customer choosing", () => {
  test("choosing rewrites the estimate to that package's lines and price", () => {
    const chosen = choosePackage(LINES, PACKAGES, "pkg3", 0, 0);
    assert.equal(chosen.pkg.name, "Best");
    assert.deepEqual(chosen.lineItems.map((l) => l.id), ["house wash", "windows", "gutters"]);
    assert.equal(chosen.totals.total, 550);
  });

  test("anything but one of its own package ids is refused", () => {
    for (const id of ["pkg9", "", null, undefined, 3, { id: "pkg1" }, "__proto__"]) {
      assert.equal(choosePackage(LINES, PACKAGES, id, 0, 0), null, String(id));
    }
  });
});

describe("checking packages before saving", () => {
  test("a valid offer passes, and no packages at all is an ordinary estimate", () => {
    assert.equal(packagesProblem(LINES, PACKAGES), null);
    assert.equal(packagesProblem(LINES, []), null);
  });

  test("one package, a nameless package or an empty package is refused", () => {
    assert.match(packagesProblem(LINES, PACKAGES.slice(0, 1)), /at least two/);
    assert.match(packagesProblem(LINES, [{ id: "pkg1", name: " " }, PACKAGES[1]]), /name/);
    assert.match(packagesProblem([line("a", 1, "pkg1")], PACKAGES.slice(0, 2)), /Better has no lines/);
  });

  test("lines of a removed package go back to being shared", () => {
    const tidy = tidyLines(LINES, PACKAGES.slice(0, 2));
    assert.equal(tidy.find((l) => l.id === "gutters").package, undefined);
    assert.equal(tidy.find((l) => l.id === "driveway").package, "pkg1");
  });
});
