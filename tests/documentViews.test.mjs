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

describe("the stamps that would have been wrong", () => {
  // Every one of these came out of an adversarial review of the first version
  // of this feature. Each is a concrete way the board would have said "the
  // customer read your quote" about somebody who had not.
  const beacon = code("components/documents/RecordView.tsx");
  const views = code("lib/server/documentViews.ts");
  const screen = code("components/documents/DocumentScreen.tsx");

  test("the crew checking their own link does not stamp it", () => {
    // The CRM offers an anchor labelled "Open it yourself to check" pointing
    // at the customer URL. It exists to be tapped. Without a marker on it,
    // that tap was the likeliest false Opened in the whole app.
    assert.match(
      screen,
      /href=\{`\$\{linkUrl\}\?crew=1`\}/,
      "the CRM's own check-link must carry ?crew=1",
    );
    assert.match(
      beacon,
      /URLSearchParams\(window\.location\.search\)\.has\("crew"\)/,
      "and the beacon must refuse to fire when it sees it",
    );
  });

  test("a draft is never stamped, and the stamp cannot predate sending", () => {
    // ensureShareToken mints a token whenever somebody asks, without waiting
    // for the document to be sent, and the public page renders a draft. So an
    // open before sending would still be sitting there afterwards, and the
    // board would say the customer read it before it left.
    assert.match(views, /const STAMPABLE/, "the stampable statuses are named");
    assert.doesNotMatch(
      views.slice(views.indexOf("const STAMPABLE"), views.indexOf("export async function")),
      /"draft"/,
      "draft must not be among them",
    );
    assert.match(
      views,
      /if \(!STAMPABLE\.has\(/,
      "and the write must refuse a status that is not one of them",
    );
  });

  test("a reload or a trip through Stripe is not a fresh open", () => {
    // Stripe's success and cancel URLs both land back on this page, so paying
    // an invoice would otherwise cost two or three "opens" — and the count is
    // read as interest.
    assert.match(views, /const SAME_VISIT_MS/, "a same-visit window exists");
    assert.match(
      views,
      /return "same-visit" as const;/,
      "and a visit inside it writes nothing at all",
    );
  });

  test("a background tab is not a read quote", () => {
    assert.match(
      beacon,
      /document\.visibilityState !== "visible"/,
      "visibility must be checked",
    );
    // Inside the timer's own callback, not only before it is armed. There is
    // a check in both places now and both earn their keep: the first stops a
    // hidden page starting the clock at all, and this one stops a page that
    // was backgrounded a second after opening from counting as read.
    const body = beacon.slice(beacon.indexOf("setTimeout("), beacon.indexOf("}, DWELL_MS)"));
    assert.ok(body.length > 0, "the dwell timer was not found");
    assert.match(
      body,
      /document\.visibilityState !== "visible"/,
      "the check must be re-made when the timer fires — a tab backgrounded a " +
        "second after opening is not a read quote",
    );
  });

  test("coming back to a page you left still counts", () => {
    // Codex's finding on the first version. A link tapped from a message
    // thread can open behind the messages app, and a prerender is a page
    // nobody has chosen to look at yet. Returning on either and never trying
    // again meant a customer who opened the quote, got distracted, and came
    // back to read it properly was recorded as never having seen it — which
    // reads on the board as "the text never arrived".
    assert.match(
      beacon,
      /addEventListener\("visibilitychange"/,
      "becoming visible must be able to start the clock",
    );
    assert.match(
      beacon,
      /addEventListener\("prerenderingchange"/,
      "and so must a prerender being activated",
    );
    assert.match(
      beacon,
      /removeEventListener\("visibilitychange"/,
      "and both must be removed on unmount",
    );
    assert.match(beacon, /removeEventListener\("prerenderingchange"/);
  });

  test("going away mid-dwell restarts the clock rather than banking it", () => {
    // Three seconds of someone actually looking, not three seconds of elapsed
    // time with the page behind something else.
    assert.match(
      beacon,
      /document\.visibilityState === "visible" \? arm\(\) : clear\(\)/,
      "hidden must clear the pending timer",
    );
  });

  test("a speculative load is skipped outright", () => {
    assert.match(beacon, /prerendering/, "the browser says so; there is no need to guess");
  });

  test("the page must be open a moment before it counts", () => {
    // Corporate mail scanners (Defender Safe Links, Proofpoint, Mimecast) do
    // render pages with a real browser. The dwell is what separates them from
    // somebody actually reading a price.
    assert.match(beacon, /const DWELL_MS = \d+/, "a dwell is defined");
    assert.match(beacon, /setTimeout\(/, "and the fetch waits for it");
  });

  test("the honest limits are written down, not glossed", () => {
    // The feature's whole value is that the owner can trust the word. A
    // comment claiming more defence than the code has would be the most
    // expensive kind of wrong here, so the file names what it does NOT stop.
    const prose = read("components/documents/RecordView.tsx");
    assert.match(prose, /NOT stopped/, "the file must say what gets through");
    assert.match(prose, /Apple/, "and name the one that matters on a texted link");
  });
});
