/** The "Pay with Venmo" link on an invoice. */
import assert from "node:assert/strict";
import { test } from "node:test";

const { venmoPayUrl, venmoUsername } = await import("../lib/venmoLink.ts");

test("a handle in any shape becomes the bare username", () => {
  for (const h of ["@SomeHandle1", "SomeHandle1", "venmo.com/u/SomeHandle1", "https://venmo.com/u/SomeHandle1?x=1"]) {
    assert.equal(venmoUsername(h), "SomeHandle1", h);
  }
  assert.equal(venmoUsername(""), null);
  assert.equal(venmoUsername("not a handle!"), null);
});

test("Nicolas's handle works the same", () => {
  assert.equal(new URL(venmoPayUrl("https://www.venmo.com/u/grimebustersky", 120, "Invoice 8904")).pathname, "/grimebustersky");
});

test("the link fills in the amount and names the invoice", () => {
  const url = new URL(venmoPayUrl("@SomeHandle1", 45, "Invoice 8904 · Example Lawn Co"));
  assert.equal(url.origin + url.pathname, "https://venmo.com/SomeHandle1");
  assert.equal(url.searchParams.get("txn"), "pay");
  assert.equal(url.searchParams.get("amount"), "45.00");
  assert.equal(url.searchParams.get("note"), "Invoice 8904 · Example Lawn Co");
});

test("no handle or nothing owed means no link", () => {
  assert.equal(venmoPayUrl(null, 45, "x"), null);
  assert.equal(venmoPayUrl("@SomeHandle1", 0, "x"), null);
});
