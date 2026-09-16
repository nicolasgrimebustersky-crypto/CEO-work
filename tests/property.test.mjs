/**
 * A house or a business, and what that changes.
 *
 * The feature is small on screen — one toggle and a list — and the whole of it
 * rests on three questions this file answers: what a record written before the
 * field existed reads as, what happens to a site nobody could geocode, and
 * what happens to a commercial customer's other sites when somebody switches
 * them back to residential.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { asLocations, asPropertyType, propertyFields } = await import("../lib/property.ts");

describe("reading the type off a stored record", () => {
  test("a record written before the field existed is a house", () => {
    // The overwhelming majority, and the reading that changes nothing about
    // how those records already behave.
    assert.equal(asPropertyType(undefined), "residential");
  });

  test("so is anything that is not one of the two", () => {
    assert.equal(asPropertyType("industrial"), "residential");
    assert.equal(asPropertyType(7), "residential");
    assert.equal(asPropertyType(null), "residential");
  });

  test("commercial survives the round trip", () => {
    assert.equal(asPropertyType("commercial"), "commercial");
  });
});

describe("reading the extra sites", () => {
  test("a missing field is no sites, not a crash", () => {
    assert.deepEqual(asLocations(undefined), []);
    assert.deepEqual(asLocations("1815 Shelbyville Rd"), []);
  });

  test("an address is the whole requirement — a site with no fix is kept", () => {
    // 0,0 is what lib/maps.ts reads as "no coordinates", so this site
    // navigates by its written address instead. Dropping the row would lose
    // a place somebody still has to drive to.
    assert.deepEqual(asLocations([{ address: "410 Herr Ln, Louisville KY" }]), [
      { address: "410 Herr Ln, Louisville KY", lat: 0, lng: 0 },
    ]);
  });

  test("a row that names nowhere is dropped", () => {
    assert.deepEqual(asLocations([{ address: "   ", lat: 38.2, lng: -85.6 }, null, 3]), []);
  });

  test("coordinates that are not numbers fall back rather than poisoning the pin", () => {
    const [site] = asLocations([{ address: "9200 Westport Rd", lat: "38.29", lng: NaN }]);
    assert.deepEqual(site, { address: "9200 Westport Rd", lat: 0, lng: 0 });
  });

  test("whitespace around a typed address does not survive", () => {
    const [site] = asLocations([{ address: "  1815 Shelbyville Rd  ", lat: 38.2447, lng: -85.5389 }]);
    assert.equal(site.address, "1815 Shelbyville Rd");
  });
});

describe("what gets written", () => {
  const sites = [
    { address: "1815 Shelbyville Rd", lat: 38.2447, lng: -85.5389 },
    { address: "410 Herr Ln", lat: 38.2718, lng: -85.6156 },
  ];

  test("a commercial customer keeps every site", () => {
    assert.deepEqual(propertyFields("commercial", sites), {
      propertyType: "commercial",
      addresses: sites,
    });
  });

  test("switching back to residential actually drops them", () => {
    // Not merely hides them. Kept-but-invisible sites reappear the moment
    // somebody flips the type again, and by then nobody can say whether they
    // were meant to still be there.
    assert.deepEqual(propertyFields("residential", sites), {
      propertyType: "residential",
      addresses: [],
    });
  });

  test("a residential record cannot be given a second address", () => {
    const { addresses } = propertyFields("residential", [{ address: "2 Oak St", lat: 1, lng: 2 }]);
    assert.equal(addresses.length, 0);
  });

  test("a half-typed row does not reach the database", () => {
    const { addresses } = propertyFields("commercial", [
      { address: "", lat: 0, lng: 0 },
      ...sites,
    ]);
    assert.deepEqual(addresses, sites);
  });
});
