/** The "Pay with Venmo" link on an invoice. */
import assert from "node:assert/strict";
import { test } from "node:test";

const { venmoPayUrl, venmoUsername } = await import("../lib/venmoLink.ts");

test("a handle in any shape becomes the bare username", () => {
  for (const h of ["@Radams1015", "Radams1015", "venmo.com/u/Radams1015", "https://venmo.com/u/Radams1015?x=1"]) {
    assert.equal(venmoUsername(h), "Radams1015", h);
  }
  assert.equal(venmoUsername(""), null);
  assert.equal(venmoUsername("not a handle!"), null);
});

test("Nicolas's handle works the same", () => {
  assert.equal(new URL(venmoPayUrl("@NicolasTimmons", 120, "Invoice 8904")).pathname, "/NicolasTimmons");
});

test("the link fills in the amount and names the invoice", () => {
  const url = new URL(venmoPayUrl("@Radams1015", 45, "Invoice 8904 · RDA Landscape"));
  assert.equal(url.origin + url.pathname, "https://venmo.com/Radams1015");
  assert.equal(url.searchParams.get("txn"), "pay");
  assert.equal(url.searchParams.get("amount"), "45.00");
  assert.equal(url.searchParams.get("note"), "Invoice 8904 · RDA Landscape");
});

test("no handle or nothing owed means no link", () => {
  assert.equal(venmoPayUrl(null, 45, "x"), null);
  assert.equal(venmoPayUrl("@Radams1015", 0, "x"), null);
});
