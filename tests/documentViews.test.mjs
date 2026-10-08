/**
 * The "Opened" stamp, and the two ways it could quietly become a lie.
 *
 * The feature answers one question: did the customer actually look at the
 * quote? A stamp that is wrong is worse than no stamp, because it is wrong
 * confidently — somebody rings a customer about a decision they have never
 * been asked to make, or stops chasing a quote that never arrived.
 *
 * Two things can make it wrong, and neither is visible in the pure rule that
 * tests/documents.test.mjs covers:
 *
 *   1. Link previews. iMessage, WhatsApp, Messenger, Slack and Outlook fetch
 *      a URL the moment it is sent. Stamping during the server render would
 *      mark every estimate opened seconds after texting it, by the bot. The
 *      defence is that the stamp is written from the browser after hydration,
 *      and preview fetchers do not run JavaScript.
 *   2. A second visit moving the first-seen time forward, so the record says
 *      they first looked later than they did.
 *
 * These are source assertions and are not presented as more than that: the
 * route and the component import firebase-admin and React and cannot be
 * loaded by node the way the pure modules can. What they buy is that the next
 * person to move this code gets a failing build in a file explaining why the
 * placement matters.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** Comments stripped: these assert what the code does, not what it says. */
const code = (path) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

describe("a link preview must not count as the customer looking", () => {
  test("the stamp is fired from the browser, not the server render", () => {
    const beacon = code("components/documents/RecordView.tsx");
    assert.match(beacon, /^"use client";/, "RecordView must be a client component");
    assert.match(
      beacon,
      /useEffect\(/,
      "the fetch must run in an effect — that is what a preview fetcher will not do",
    );
    assert.match(beacon, /\/viewed/, "and it must call the viewed route");
  });

  test("the page renders the beacon rather than stamping as it renders", () => {
    const page = code("app/v/[token]/page.tsx");
    assert.match(page, /<RecordView token=\{token\}/, "the page must mount the beacon");
    assert.doesNotMatch(
      page,
      /recordDocumentView/,
      "the page must not stamp during its own server render: every messaging " +
        "app that shows a preview card would mark the quote opened on send",
    );
  });

  test("the viewed route does not stamp on a GET", () => {
    // A GET is what a crawler or a prefetcher issues. Only POST writes.
    const route = code("app/api/quote/[token]/viewed/route.ts");
    assert.doesNotMatch(route, /export async function GET/, "no GET handler");
    assert.match(route, /export async function POST/, "POST is the only writer");
  });

  test("the beacon fires once per mount", () => {
    // React's strict mode runs effects twice in development. A count that
    // reads 2 for one visit is a small lie in the same direction as the big one.
    const beacon = code("components/documents/RecordView.tsx");
    assert.match(beacon, /useRef\(false\)/, "a ref guards the double-invoke");
    assert.match(beacon, /if \(sent\.current\) return;/, "and returns early on the second");
  });
});

describe("the first open is the one that must not move", () => {
  const views = code("lib/server/documentViews.ts");

  test("firstViewedAt is written only when it is not already set", () => {
    assert.match(
      views,
      /\.\.\.\(already \? \{\} : \{ firstViewedAt: now \}\)/,
      "a later visit must not rewrite when they first looked",
    );
  });

  test("it reads and writes in one transaction", () => {
    // Two requests can land together — a customer who taps twice, or opens it
    // on a phone and a laptop at once. Read-then-write without a transaction
    // lets the second overwrite the first stamp.
    assert.match(views, /runTransaction\(/, "the read and the write must be atomic");
    assert.match(views, /tx\.get\(ref\)/, "and the read must be inside it");
  });

  test("last-seen and the count move every time", () => {
    assert.match(views, /lastViewedAt: now/);
    assert.match(views, /viewCount: FieldValue\.increment\(1\)/);
  });
});

describe("an unauthenticated writer stays narrow", () => {
  const route = code("app/api/quote/[token]/viewed/route.ts");

  test("the document comes from resolving the token, never from the caller", () => {
    assert.match(route, /findByShareToken\(token\)/, "the token is resolved first");
    assert.match(
      route,
      /recordDocumentView\(found\.document\.id\)/,
      "and the id written is the resolved one, not anything from the request",
    );
    assert.doesNotMatch(
      route,
      /request\.json\(\)/,
      "there is nothing in a body this route should read",
    );
  });

  test("it is rate limited per document", () => {
    assert.match(route, /consumeRateLimit\(\s*`quoteview:\$\{found\.document\.id\}`/);
  });

  test("a bad token gets the same answer a real one does", () => {
    // A different reply for an unknown token would confirm to somebody
    // guessing which tokens are real.
    const bodies = route.match(/new Response\(null, \{ status: (\d+) \}\)/g) ?? [];
    assert.ok(bodies.length >= 3, "every path answers the same way");
    assert.ok(
      bodies.every((b) => b.includes("204")),
      `every response must be a bare 204; saw ${bodies.join(", ")}`,
    );
  });

  test("a failed stamp never breaks the customer's view of their quote", () => {
    assert.match(
      route,
      /try \{\s*await recordDocumentView/,
      "the write is wrapped — the page is already rendered behind it",
    );
  });

  test("the customer's own copy does not carry the stamps back to them", () => {
    const serial = code("lib/server/publicDocument.ts");
    for (const field of ["firstViewedAt", "lastViewedAt", "viewCount"]) {
      assert.match(
        serial,
        new RegExp(`\\|\\s*"${field}"`),
        `${field} must be omitted from what is sent to the customer`,
      );
    }
  });
});
