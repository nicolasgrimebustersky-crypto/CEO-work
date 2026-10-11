/**
 * The "Opened" stamp, and the two ways it could quietly become a lie.
 *
 * The feature answers one question: did the customer actually look at the
 * quote? A stamp that is wrong is worse than no stamp, because it is wrong
 * confidently — somebody rings a customer about a decision they have never
 * been asked to make, or stops chasing a quote that never arrived.
 *
 * Two things can make it wrong:
 *
 *   1. Link previews. iMessage, WhatsApp, Messenger, Slack and Outlook fetch
 *      a URL the moment it is sent. Stamping during the server render would
 *      mark every estimate opened seconds after texting it, by the bot. The
 *      defence is that the stamp is written from the browser after hydration,
 *      and preview fetchers do not run JavaScript.
 *   2. A second visit moving the first-seen time forward, so the record says
 *      they first looked later than they did.
 *
 * This file used to be source assertions throughout, which Codex rightly
 * objected to: a regex proves the code says something, never that it does it.
 * A transaction reading the wrong field, an increment that double-counts, a
 * boundary an hour out — all of those pass a source match. So the decisions
 * were moved somewhere they can be run, and this file now has three kinds of
 * test, labelled as such:
 *
 *   - RUN HERE: every combination of the arm/fire decision, from the pure
 *     lib/documentViewBeacon.ts.
 *   - RUN ELSEWHERE: what the write actually does to a document, against a
 *     real Firestore emulator — tests/documentViews.server.test.mjs, via
 *     `npm run test:server`. The route's own replies are in
 *     tests/api.auth.test.mjs, against a running server.
 *   - PLACEMENT ONLY: that the beacon is mounted in the browser and not in
 *     the server render, and that the route has no GET. These are claims
 *     about where code sits, which is the one thing a regex is fit to check.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";

const { DWELL_MS, isCrewLink, shouldArm, shouldFire } = await import(
  "../lib/documentViewBeacon.ts"
);

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** Comments stripped: these assert what the code does, not what it says. */
const code = (path) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

describe("when an open page counts as somebody reading it", () => {
  // Every mistake in this table is a false "Opened", which is worse than no
  // feature at all: it sends somebody chasing a decision the customer has
  // never been asked to make, and it does it confidently.
  //
  // The sixteen rows are written out by hand rather than generated from the
  // rule, so that changing the rule fails here instead of quietly agreeing
  // with itself.
  const state = (patch) => ({
    prerendering: false,
    visible: true,
    sent: false,
    armed: false,
    ...patch,
  });

  const ARM_TABLE = [
    // prerendering, visible, sent, armed, should arm
    [false, true, false, false, true, "a real reader with the page in front of them"],
    [false, false, false, false, false, "opened behind the messages app"],
    [true, true, false, false, false, "a prerender nobody chose to open"],
    [true, false, false, false, false, "a prerender that is also hidden"],
    [false, true, true, false, false, "already reported this visit"],
    [false, true, false, true, false, "the clock is already running"],
    [false, true, true, true, false, "both, which must not restart anything"],
    [false, false, true, false, false, "reported, and now hidden"],
    [false, false, false, true, false, "hidden with a stale timer"],
    [true, true, true, false, false, "prerendering and already reported"],
    [true, true, false, true, false, "prerendering with a timer running"],
    [true, false, true, false, false, "prerender, hidden, reported"],
    [true, false, false, true, false, "prerender, hidden, armed"],
    [false, false, true, true, false, "hidden, reported, armed"],
    [true, true, true, true, false, "everything at once"],
    [true, false, true, true, false, "everything at once, hidden"],
  ];

  for (const [prerendering, visible, sent, armed, expected, why] of ARM_TABLE) {
    test(`${expected ? "arms" : "does not arm"}: ${why}`, () => {
      assert.equal(shouldArm({ prerendering, visible, sent, armed }), expected);
    });
  }

  test("only one row in the table arms", () => {
    // Stated separately because it is the property that matters: the clock
    // starts in exactly one situation, a visible page nobody has counted yet.
    assert.equal(ARM_TABLE.filter((row) => row[4]).length, 1);
  });

  test("coming back to a page you left arms again", () => {
    // The false-negative direction, and the one a previous version got wrong:
    // it returned on a hidden or prerendering page and never asked again, so a
    // customer who opened the quote, got distracted and came back to read it
    // properly was recorded as never having seen it. That reads on the board
    // as "the text never arrived" and sends somebody chasing the wrong thing.
    assert.equal(shouldArm(state({ visible: false })), false, "not while they are away");
    assert.equal(shouldArm(state({ visible: true })), true, "but yes when they return");
  });

  test("an activated prerender arms once it is a real page", () => {
    assert.equal(shouldArm(state({ prerendering: true })), false);
    assert.equal(shouldArm(state({ prerendering: false })), true);
  });
});

describe("whether to report it when the clock finishes", () => {
  const FIRE_TABLE = [
    [true, false, true, "still in front of them after the dwell"],
    [false, false, false, "backgrounded a second after opening"],
    [true, true, false, "already reported"],
    [false, true, false, "backgrounded and already reported"],
  ];

  for (const [visible, sent, expected, why] of FIRE_TABLE) {
    test(`${expected ? "reports" : "does not report"}: ${why}`, () => {
      assert.equal(shouldFire({ visible, sent, prerendering: false, armed: true }), expected);
    });
  }

  test("visibility is checked again at the end, not only at the start", () => {
    // A tab backgrounded one second in is not a read quote. If this only
    // looked at the state when the clock started, every link opened and
    // immediately swiped away would stamp.
    assert.equal(shouldArm({ prerendering: false, visible: true, sent: false, armed: false }), true);
    assert.equal(shouldFire({ prerendering: false, visible: false, sent: false, armed: true }), false);
  });

  test("a prerender that somehow reaches the end is not blocked by it", () => {
    // Deliberate: a page cannot go back to being a prerender, and the
    // activation that ends one is what arms the clock. Re-checking it here
    // would only create a way to lose a real view.
    assert.equal(shouldFire({ prerendering: true, visible: true, sent: false, armed: true }), true);
  });
});

describe("the crew's own look at the link", () => {
  // The likeliest false stamp in the app: somebody on the crew opening the
  // quote to check it looks right, recorded as the customer reading it.
  test("?crew=1 is recognised", () => {
    assert.equal(isCrewLink("?crew=1"), true);
    assert.equal(isCrewLink("?crew"), true, "the value is not what matters");
    assert.equal(isCrewLink("?foo=1&crew=1"), true);
  });

  test("a customer's link is not", () => {
    assert.equal(isCrewLink(""), false);
    assert.equal(isCrewLink("?utm_source=sms"), false);
    assert.equal(isCrewLink("?crewmember=1"), false, "a prefix is not the flag");
  });

  test("the dwell is three seconds", () => {
    // Named so a change has to be deliberate: shortening it lets headless
    // scanners through, lengthening it loses customers who glance and leave.
    assert.equal(DWELL_MS, 3000);
  });
});

describe("placement: a link preview must not count as the customer looking", () => {
  // Where this code runs is the whole defence, and it is not something the
  // pure rules above can show. A preview fetcher parses HTML and never
  // executes a script, so a stamp written from an effect is one it cannot
  // trigger — and a stamp written during the server render is one it always
  // would.
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

describe("placement: the component asks the rules rather than reimplementing them", () => {
  // The combinations are tested above by running them. What is left to check
  // is that the component actually consults that module — a copy of the logic
  // inlined here would pass every test above and still be wrong.
  const beacon = code("components/documents/RecordView.tsx");

  test("arming and firing both go through the pure decision", () => {
    assert.match(beacon, /shouldArm\(state\(\)\)/, "the clock starts only when it says so");
    assert.match(beacon, /shouldFire\(state\(\)\)/, "and the fetch runs only when it says so");
  });

  test("the state is re-read when the timer fires, not captured at arm time", () => {
    // Otherwise a tab backgrounded one second in would still stamp: the
    // decision would be made against how things looked three seconds ago.
    const body = beacon.slice(beacon.indexOf("setTimeout("), beacon.indexOf("}, DWELL_MS)"));
    assert.ok(body.length > 0, "the dwell timer was not found");
    assert.match(body, /shouldFire\(state\(\)\)/, "freshly, inside the callback");
  });

  test("becoming visible, or a prerender activating, can start the clock", () => {
    assert.match(beacon, /addEventListener\("visibilitychange"/);
    assert.match(beacon, /addEventListener\("prerenderingchange"/);
    assert.match(beacon, /removeEventListener\("visibilitychange"/, "and are removed");
    assert.match(beacon, /removeEventListener\("prerenderingchange"/);
  });

  test("going away mid-dwell clears the timer rather than banking it", () => {
    // Three seconds of someone actually looking, not three seconds of elapsed
    // time with the page behind something else.
    assert.match(
      beacon,
      /document\.visibilityState === "visible" \? arm\(\) : clear\(\)/,
      "hidden must clear the pending timer",
    );
  });

  test("the crew's own check-link carries the marker the rules look for", () => {
    // The CRM offers an anchor labelled "Open it yourself to check" pointing
    // at the customer URL. It exists to be tapped. Without a marker on it,
    // that tap was the likeliest false Opened in the whole app. isCrewLink is
    // tested by running it above; this is the other half — that the link the
    // crew taps actually carries the flag.
    assert.match(
      code("components/documents/DocumentScreen.tsx"),
      /href=\{`\$\{linkUrl\}\?crew=1`\}/,
      "the CRM's own check-link must carry ?crew=1",
    );
    assert.match(beacon, /isCrewLink\(window\.location\.search\)/, "and the beacon checks it");
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

describe("placement: an unauthenticated writer stays narrow", () => {
  // What this route replies is tested against a running server in
  // tests/api.auth.test.mjs. What is checked here is the shape of what it
  // touches, because the dangerous version of this route is one that writes
  // something the caller chose.
  const route = code("app/api/quote/[token]/viewed/route.ts");

  test("the document comes from resolving the token, never from the caller", () => {
    assert.match(route, /findByShareToken\(token\)/, "the token is resolved first");
    assert.match(
      route,
      /recordDocumentView\(found\.document\.id\)/,
      "and the id written is the resolved one, not anything from the request",
    );
  });

  test("the request body is never read", () => {
    // There is nothing in it this route needs, and reading it would be the
    // beginning of trusting it.
    assert.doesNotMatch(route, /request\.json\(\)/, "no body is parsed");
    assert.doesNotMatch(route, /request\.text\(\)/);
  });

  test("it is rate limited per document", () => {
    assert.match(route, /consumeRateLimit\(\s*`quoteview:\$\{found\.document\.id\}`/);
  });

  test("every path answers with a bare 204", () => {
    // A different reply for an unknown token would confirm to somebody
    // guessing which tokens are real. Checked across the whole file rather
    // than by exercising paths, because the claim is about all of them.
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
});
