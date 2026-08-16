/**
 * Security-rules tests for firestore.rules, run against the Firestore emulator.
 *
 *   npm run test:rules
 *
 * The allowlist in firestore.rules ships with placeholder uids; this harness
 * swaps them for 'alice' and 'bob' so the rules can be exercised without
 * anyone's real uid being committed. That means the tests keep working after
 * you fill in the real uids, and they will catch it if a future edit widens
 * access beyond the two crew accounts.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, before, after, beforeEach, describe } from "node:test";

import { rulesWithTestCrew } from "./rulesSource.mjs";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let testEnv;
let alice;
let bob;
let mallory;
let dana;
let newbie;
let admin;
let anon;

/* ---------------------------------------------------------------- fixtures */

function customerDoc(uid, overrides = {}) {
  return {
    firstName: "Test",
    lastName: "House",
    status: "lead",
    pipelineStage: "new_lead",
    lat: 38.4,
    lng: -85.4,
    notes: [],
    createdBy: uid,
    updatedBy: uid,
    ...overrides,
  };
}

function jobDoc(uid, overrides = {}) {
  return {
    customerId: "c1",
    serviceType: "pressure_washing",
    status: "scheduled",
    price: 250,
    assignedTo: [uid],
    beforePhotos: [],
    afterPhotos: [],
    jobNotes: "",
    createdBy: uid,
    updatedBy: uid,
    ...overrides,
  };
}

function quoteDoc(uid, overrides = {}) {
  return {
    customerId: "c1",
    serviceType: "landscaping",
    amount: 400,
    status: "sent",
    sentBy: uid,
    sentByName: "Test",
    followUpCount: 0,
    ...overrides,
  };
}

function businessDoc(uid, overrides = {}) {
  return {
    number: "8904",
    kind: "estimate",
    status: "draft",
    customerId: "c1",
    customerName: "Test House",
    serviceType: "pressure_washing",
    lineItems: [
      { id: "li-1", description: "House wash", quantity: 1, unitPrice: 450, taxable: true },
    ],
    payments: [],
    discount: 0,
    taxRatePct: 6,
    subtotal: 450,
    taxAmount: 27,
    total: 477,
    amountPaid: 0,
    balanceDue: 477,
    notes: "",
    createdBy: uid,
    updatedBy: uid,
    ...overrides,
  };
}

function serviceDoc(uid, overrides = {}) {
  return {
    name: "House wash",
    description: "Soft wash, two storey, includes gutter faces",
    unitPrice: 450,
    serviceType: "pressure_washing",
    taxable: true,
    timesUsed: 3,
    createdBy: uid,
    ...overrides,
  };
}

function notificationDoc(actorUid, forUid, overrides = {}) {
  return {
    forUid,
    actorUid,
    actorName: "Test",
    type: "job_created",
    title: "Job scheduled",
    body: "somewhere",
    customerId: "c1",
    jobId: "j1",
    readAt: null,
    ...overrides,
  };
}

/** A write shaped exactly like what lib/db/* sends, stamps included. */
function stampedUpdate(uid, fields) {
  return { ...fields, updatedBy: uid, updatedAt: serverTimestamp() };
}

before(async () => {
  const rules = rulesWithTestCrew(join(repoRoot, "firestore.rules"));

  testEnv = await initializeTestEnvironment({
    projectId: "gb-rules-test",
    firestore: { rules, host: "127.0.0.1", port: 8080 },
  });

  alice = testEnv.authenticatedContext("alice").firestore();
  bob = testEnv.authenticatedContext("bob").firestore();
  mallory = testEnv.authenticatedContext("mallory").firestore();
  // Registered and approved — crew by role rather than by uid.
  dana = testEnv.authenticatedContext("dana").firestore();
  // Signed in with no profile document at all: the instant after registering.
  newbie = testEnv.authenticatedContext("newbie").firestore();
  // The one account that can grant access. Identified by the email on its
  // token, which is what the rules check — not by uid, and not by anything
  // stored in the database.
  admin = testEnv
    .authenticatedContext("nicolas", { email: "nicolas.grimebustersky@gmail.com" })
    .firestore();
  anon = testEnv.unauthenticatedContext().firestore();
});

/**
 * Reset between tests. Without this, one test's writes change what the next
 * one is asserting against — which cost real debugging time when a status
 * change in an earlier run made a later expectation look broken.
 */
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "customers/c1"), customerDoc("alice"));
    await setDoc(doc(db, "jobs/j1"), jobDoc("alice"));
    await setDoc(doc(db, "quotes/q1"), quoteDoc("alice"));
    await setDoc(doc(db, "notifications/n1"), notificationDoc("alice", "bob"));
    await setDoc(doc(db, "documents/d1"), businessDoc("alice"));
    await setDoc(doc(db, "services/s1"), serviceDoc("alice"));
    // Alice and Bob deliberately have NO role field. They are the bootstrap
    // uids, and the rules must treat them as crew regardless — that is what
    // stops a profile mishap locking the owners out of their own business.
    await setDoc(doc(db, "users/alice"), { displayName: "Alice" });
    await setDoc(doc(db, "users/bob"), { displayName: "Bob" });
    await setDoc(doc(db, "users/mallory"), { displayName: "Mallory", role: "pending" });
    await setDoc(doc(db, "users/dana"), { displayName: "Dana", role: "crew" });
    await setDoc(doc(db, "knockRoutes/r1"), {
      name: "Ridgemoor sweep",
      status: "planned",
      assignedTo: ["bob"],
      stopIds: ["c1"],
      knockedIds: [],
      createdBy: "alice",
      createdByName: "Alice",
      updatedBy: "alice",
    });
    await setDoc(doc(db, "territories/t1"), {
      name: "Ridgemoor",
      boundary: [
        { lat: 38.4, lng: -85.38 },
        { lat: 38.41, lng: -85.38 },
        { lat: 38.41, lng: -85.37 },
      ],
      assignedTo: ["alice"],
      active: true,
      createdBy: "alice",
      createdByName: "Alice",
      updatedBy: "alice",
    });
    await setDoc(doc(db, "pushTokens/t-alice"), {
      uid: "alice",
      token: "alice-device-token",
      label: "iPhone · Safari",
    });
  });
});

after(async () => {
  await testEnv?.cleanup();
});

/* ------------------------------------------------------------- the gateway */

describe("the two-account allowlist", () => {
  test("a crew account can read and write customers", async () => {
    await assertSucceeds(addDoc(collection(alice, "customers"), customerDoc("alice")));
    await assertSucceeds(getDocs(collection(bob, "customers")));
  });

  test("a signed-in account that is not on the allowlist gets nothing", async () => {
    await assertFails(getDocs(collection(mallory, "customers")));
    await assertFails(addDoc(collection(mallory, "customers"), customerDoc("mallory")));
    await assertFails(getDocs(collection(mallory, "users")));
    await assertFails(getDocs(collection(mallory, "jobs")));
    await assertFails(addDoc(collection(mallory, "jobs"), jobDoc("mallory")));
    await assertFails(getDocs(collection(mallory, "quotes")));
    await assertFails(addDoc(collection(mallory, "quotes"), quoteDoc("mallory")));
    await assertFails(getDocs(collection(mallory, "notifications")));
    await assertFails(getDocs(collection(mallory, "documents")));
    await assertFails(addDoc(collection(mallory, "documents"), businessDoc("mallory")));
    await assertFails(getDocs(collection(mallory, "services")));
    await assertFails(addDoc(collection(mallory, "services"), serviceDoc("mallory")));
    await assertFails(getDocs(collection(mallory, "knockRoutes")));
    await assertFails(getDocs(collection(mallory, "territories")));
    await assertFails(getDocs(collection(mallory, "pushTokens")));
    await assertFails(
      addDoc(collection(mallory, "pushTokens"), { uid: "mallory", token: "t" }),
    );
  });

  test("an unauthenticated caller gets nothing", async () => {
    await assertFails(getDocs(collection(anon, "customers")));
    await assertFails(addDoc(collection(anon, "customers"), customerDoc("alice")));
    await assertFails(getDocs(collection(anon, "jobs")));
  });

  test("collections that are not listed in the rules are denied outright", async () => {
    await assertFails(addDoc(collection(alice, "secrets"), { x: 1 }));
  });
});

/* --------------------------------------------------------------- customers */

describe("customer author stamps", () => {
  test("a customer cannot be created under someone else's name", async () => {
    await assertFails(addDoc(collection(alice, "customers"), customerDoc("bob")));
  });

  test("an update must be stamped by the caller", async () => {
    await assertSucceeds(
      updateDoc(doc(bob, "customers/c1"), stampedUpdate("bob", { status: "quoted" })),
    );
    await assertFails(
      updateDoc(doc(bob, "customers/c1"), stampedUpdate("alice", { status: "quoted" })),
    );
  });

  test("an update that does not refresh the stamp is rejected", async () => {
    // `request.resource.data` is the merged document on an update, so a payload
    // that omits `updatedBy` inherits the stored value. The rules require
    // `updatedAt` in the diff specifically to close that path.
    await assertFails(updateDoc(doc(alice, "customers/c1"), { status: "customer" }));
    await assertFails(
      updateDoc(doc(alice, "customers/c1"), { status: "customer", updatedBy: "alice" }),
    );
  });

  test("a customer with a bogus pipeline stage is rejected", async () => {
    await assertFails(
      addDoc(collection(alice, "customers"), customerDoc("alice", { pipelineStage: "won" })),
    );
  });

  test("a customer with a bogus status or coordinates is rejected", async () => {
    await assertFails(
      addDoc(collection(alice, "customers"), customerDoc("alice", { status: "vip" })),
    );
    await assertFails(
      addDoc(collection(alice, "customers"), customerDoc("alice", { lat: "38.4" })),
    );
    await assertFails(
      addDoc(collection(alice, "customers"), customerDoc("alice", { notes: "none" })),
    );
  });
});

/* -------------------------------------------------------------------- jobs */

describe("jobs", () => {
  test("a crew member can schedule, edit and delete a job", async () => {
    const ref = await assertSucceeds(
      addDoc(collection(alice, "jobs"), jobDoc("alice")),
    );
    await assertSucceeds(
      updateDoc(doc(alice, `jobs/${ref.id}`), stampedUpdate("alice", { price: 300 })),
    );
    await assertSucceeds(deleteDoc(doc(alice, `jobs/${ref.id}`)));
  });

  test("a job cannot be created under someone else's name", async () => {
    await assertFails(addDoc(collection(alice, "jobs"), jobDoc("bob")));
  });

  test("editing a job must refresh the author stamp", async () => {
    await assertSucceeds(
      updateDoc(doc(bob, "jobs/j1"), stampedUpdate("bob", { status: "complete" })),
    );
    // No stamp at all, and a stamp naming the other person, both rejected.
    await assertFails(updateDoc(doc(bob, "jobs/j1"), { status: "complete" }));
    await assertFails(
      updateDoc(doc(bob, "jobs/j1"), stampedUpdate("alice", { status: "complete" })),
    );
  });

  test("a job with an invalid status, service or price is rejected", async () => {
    await assertFails(
      addDoc(collection(alice, "jobs"), jobDoc("alice", { status: "pending" })),
    );
    await assertFails(
      addDoc(collection(alice, "jobs"), jobDoc("alice", { serviceType: "gutters" })),
    );
    await assertFails(
      addDoc(collection(alice, "jobs"), jobDoc("alice", { price: -50 })),
    );
    await assertFails(
      addDoc(collection(alice, "jobs"), jobDoc("alice", { price: "250" })),
    );
  });
});

/* ------------------------------------------------------------------ quotes */

describe("quotes", () => {
  test("a crew member can record a quote and change its status", async () => {
    const ref = await assertSucceeds(
      addDoc(collection(alice, "quotes"), quoteDoc("alice")),
    );
    // Only the status changes here — that is exactly what setQuoteStatus sends.
    await assertSucceeds(
      updateDoc(doc(bob, `quotes/${ref.id}`), { status: "no_response" }),
    );
  });

  test("a quote cannot be created under someone else's name", async () => {
    await assertFails(addDoc(collection(alice, "quotes"), quoteDoc("bob")));
  });

  test("a quote cannot be reassigned to the other crew member after the fact", async () => {
    await assertFails(updateDoc(doc(bob, "quotes/q1"), { sentBy: "bob" }));
  });

  test("a quote cannot be moved to a different customer", async () => {
    await assertFails(updateDoc(doc(bob, "quotes/q1"), { customerId: "c2" }));
  });

  test("a quote with an invalid status or a negative amount is rejected", async () => {
    await assertFails(
      addDoc(collection(alice, "quotes"), quoteDoc("alice", { status: "maybe" })),
    );
    await assertFails(
      addDoc(collection(alice, "quotes"), quoteDoc("alice", { amount: -1 })),
    );
  });
});

/* ------------------------------------------------- estimates and invoices */

describe("estimates and invoices", () => {
  test("a crew member can raise a document, edit it and delete it", async () => {
    const ref = await assertSucceeds(
      addDoc(collection(alice, "documents"), businessDoc("alice")),
    );
    await assertSucceeds(
      updateDoc(
        doc(bob, `documents/${ref.id}`),
        stampedUpdate("bob", { subtotal: 500, total: 530, balanceDue: 530 }),
      ),
    );
    await assertSucceeds(deleteDoc(doc(alice, `documents/${ref.id}`)));
  });

  test("a document cannot be created under someone else's name", async () => {
    await assertFails(addDoc(collection(alice, "documents"), businessDoc("bob")));
  });

  test("editing a document must refresh the author stamp", async () => {
    await assertFails(updateDoc(doc(bob, "documents/d1"), { status: "sent" }));
    await assertFails(
      updateDoc(doc(bob, "documents/d1"), stampedUpdate("alice", { status: "sent" })),
    );
  });

  test("an invoice cannot be renumbered or moved to another customer", async () => {
    // Both would rewrite the financial record without leaving a trace of what
    // it used to say, which is why the rules pin them rather than the client.
    await assertFails(
      updateDoc(doc(alice, "documents/d1"), stampedUpdate("alice", { number: "1" })),
    );
    await assertFails(
      updateDoc(doc(alice, "documents/d1"), stampedUpdate("alice", { customerId: "c2" })),
    );
  });

  test("a document with a bogus kind, status or service is rejected", async () => {
    await assertFails(
      addDoc(collection(alice, "documents"), businessDoc("alice", { kind: "receipt" })),
    );
    await assertFails(
      addDoc(collection(alice, "documents"), businessDoc("alice", { status: "overdue" })),
    );
    await assertFails(
      addDoc(collection(alice, "documents"), businessDoc("alice", { serviceType: "gutters" })),
    );
  });

  test("a document with money in the wrong shape is rejected", async () => {
    await assertFails(
      addDoc(collection(alice, "documents"), businessDoc("alice", { total: "477" })),
    );
    await assertFails(
      addDoc(collection(alice, "documents"), businessDoc("alice", { total: -1 })),
    );
    await assertFails(
      addDoc(collection(alice, "documents"), businessDoc("alice", { discount: -25 })),
    );
    await assertFails(
      addDoc(collection(alice, "documents"), businessDoc("alice", { lineItems: "House wash" })),
    );
    await assertFails(
      addDoc(collection(alice, "documents"), businessDoc("alice", { number: 8904 })),
    );
  });
});

/* ---------------------------------------------------------- the price book */

describe("saved services", () => {
  test("using a service records it and bumps its count", async () => {
    const ref = await assertSucceeds(
      addDoc(collection(alice, "services"), serviceDoc("alice")),
    );
    // No author stamp to refresh: the price book is reference data, and this
    // write happens automatically when an estimate is saved.
    await assertSucceeds(
      updateDoc(doc(bob, `services/${ref.id}`), { timesUsed: 4, unitPrice: 475 }),
    );
    await assertSucceeds(deleteDoc(doc(alice, `services/${ref.id}`)));
  });

  test("a service cannot be created under someone else's name", async () => {
    await assertFails(addDoc(collection(alice, "services"), serviceDoc("bob")));
  });

  test("a nameless service is rejected — it could never be found again", async () => {
    await assertFails(
      addDoc(collection(alice, "services"), serviceDoc("alice", { name: "" })),
    );
    await assertFails(
      addDoc(collection(alice, "services"), serviceDoc("alice", { name: 42 })),
    );
  });

  test("a bad price is rejected, here and on update", async () => {
    // A wrong price in the book quietly propagates onto every future quote,
    // which is why this is stricter than the text fields.
    await assertFails(
      addDoc(collection(alice, "services"), serviceDoc("alice", { unitPrice: -1 })),
    );
    await assertFails(
      addDoc(collection(alice, "services"), serviceDoc("alice", { unitPrice: "450" })),
    );
    await assertFails(updateDoc(doc(alice, "services/s1"), { unitPrice: -5 }));
  });

  test("a bogus service type is rejected", async () => {
    await assertFails(
      addDoc(collection(alice, "services"), serviceDoc("alice", { serviceType: "gutters" })),
    );
  });
});

/* ----------------------------------------------------------- notifications */

describe("notifications", () => {
  test("a crew member can notify the other and mark one read", async () => {
    await assertSucceeds(
      addDoc(collection(alice, "notifications"), notificationDoc("alice", "bob")),
    );
    await assertSucceeds(updateDoc(doc(bob, "notifications/n1"), { readAt: serverTimestamp() }));
  });

  test("a notification cannot be attributed to the other crew member", async () => {
    await assertFails(
      addDoc(collection(alice, "notifications"), notificationDoc("bob", "alice")),
    );
  });

  test("a notification cannot be created already-read", async () => {
    await assertFails(
      addDoc(
        collection(alice, "notifications"),
        notificationDoc("alice", "bob", { readAt: serverTimestamp() }),
      ),
    );
  });

  test("marking read may not rewrite what the notification says", async () => {
    await assertFails(
      updateDoc(doc(bob, "notifications/n1"), {
        readAt: serverTimestamp(),
        title: "something else",
      }),
    );
    await assertFails(updateDoc(doc(bob, "notifications/n1"), { actorUid: "bob" }));
  });
});

/* --------------------------------------------------------------- user docs */

describe("user profiles", () => {
  test("crew can read each other's profile, which is what draws the map dots", async () => {
    const snap = await assertSucceeds(getDoc(doc(alice, "users/bob")));
    assert.equal(snap.data().displayName, "Bob");
  });

  test("an account may only write its own profile and location", async () => {
    await assertSucceeds(updateDoc(doc(alice, "users/alice"), { currentLat: 38.4 }));
    await assertFails(updateDoc(doc(alice, "users/bob"), { currentLat: 0 }));
  });

  test("an account may delete its own profile but not the other's", async () => {
    // In-app account deletion (App Store Guideline 5.1.1v) needs the owner to
    // be able to remove their own profile — but one crew member must never be
    // able to erase the other on the way out.
    await assertFails(deleteDoc(doc(alice, "users/bob")));
    await assertSucceeds(deleteDoc(doc(alice, "users/alice")));
  });
});

/* ------------------------------------------------------------- push tokens */

describe("push tokens", () => {
  test("a device may file itself", async () => {
    await assertSucceeds(
      addDoc(collection(alice, "pushTokens"), {
        uid: "alice",
        token: "a-fresh-token",
        label: "iPhone · Safari",
      }),
    );
  });

  test("a token may not be filed against the other account", async () => {
    // The whole point of the rule: a push token is a capability to interrupt a
    // specific handset, so registering one in somebody else's name would mean
    // receiving their notifications.
    await assertFails(
      addDoc(collection(alice, "pushTokens"), { uid: "bob", token: "stolen" }),
    );
    // Rewriting an existing row's uid to yourself would satisfy a naive
    // "uid == request.auth.uid" check and quietly point your notifications at
    // the other person's phone. Both identifying fields are pinned on update.
    await assertFails(updateDoc(doc(bob, "pushTokens/t-alice"), { uid: "bob" }));
    await assertFails(
      updateDoc(doc(alice, "pushTokens/t-alice"), { token: "a-different-token" }),
    );
  });

  test("a token has to actually be a token", async () => {
    await assertFails(
      addDoc(collection(alice, "pushTokens"), { uid: "alice", token: "" }),
    );
    await assertFails(
      addDoc(collection(alice, "pushTokens"), { uid: "alice", token: 12345 }),
    );
    await assertFails(
      addDoc(collection(alice, "pushTokens"), {
        uid: "alice",
        token: "x".repeat(1200),
      }),
    );
  });

  test("crew can read the collection, and clean up a stale device", async () => {
    await assertSucceeds(getDocs(collection(alice, "pushTokens")));
    await assertSucceeds(deleteDoc(doc(alice, "pushTokens/t-alice")));
  });

  test("an unauthenticated caller can neither read nor register", async () => {
    await assertFails(getDocs(collection(anon, "pushTokens")));
    await assertFails(
      addDoc(collection(anon, "pushTokens"), { uid: "alice", token: "t" }),
    );
  });
});

/* ------------------------------------------------------ door-knock routes */

describe("door-knocking routes", () => {
  const routeDoc = (by, over = {}) => ({
    name: "Elm Hollow",
    status: "planned",
    assignedTo: [],
    stopIds: ["c1"],
    knockedIds: [],
    createdBy: by,
    createdByName: by,
    updatedBy: by,
    updatedAt: serverTimestamp(),
    ...over,
  });

  test("a crew member can plan a route and hand it to the other", async () => {
    await assertSucceeds(addDoc(collection(alice, "knockRoutes"), routeDoc("alice")));
    // Either of you can pick up the other's afternoon, so reassigning is allowed.
    await assertSucceeds(
      updateDoc(doc(bob, "knockRoutes/r1"), {
        assignedTo: ["alice"],
        updatedBy: "bob",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test("a route cannot be attributed to somebody else", async () => {
    await assertFails(addDoc(collection(alice, "knockRoutes"), routeDoc("bob")));
  });

  test("an edit has to say who made it", async () => {
    // Without the refreshed stamp, "last changed by" on the screen is a lie.
    await assertFails(updateDoc(doc(bob, "knockRoutes/r1"), { name: "Renamed" }));
    await assertFails(
      updateDoc(doc(bob, "knockRoutes/r1"), { name: "Renamed", updatedBy: "alice" }),
    );
  });

  test("the shape has to be one the other phone can render", async () => {
    await assertFails(
      addDoc(collection(alice, "knockRoutes"), routeDoc("alice", { status: "wandering" })),
    );
    await assertFails(
      addDoc(collection(alice, "knockRoutes"), routeDoc("alice", { stopIds: "c1" })),
    );
    await assertFails(
      addDoc(collection(alice, "knockRoutes"), routeDoc("alice", { name: 42 })),
    );
  });

  test("a route cannot grow past what fits in a document", async () => {
    const tooMany = Array.from({ length: 401 }, (_, i) => `c${i}`);
    await assertFails(
      addDoc(collection(alice, "knockRoutes"), routeDoc("alice", { stopIds: tooMany })),
    );
  });

  test("an unauthenticated caller gets nothing", async () => {
    await assertFails(getDocs(collection(anon, "knockRoutes")));
    await assertFails(addDoc(collection(anon, "knockRoutes"), routeDoc("alice")));
  });
});

/* --------------------------------------------------------------- territory */

describe("territories", () => {
  const square = [
    { lat: 38.4, lng: -85.38 },
    { lat: 38.41, lng: -85.38 },
    { lat: 38.41, lng: -85.37 },
    { lat: 38.4, lng: -85.37 },
  ];
  const territoryDoc = (by, over = {}) => ({
    name: "Oak Ridge",
    boundary: square,
    assignedTo: [],
    active: true,
    notes: "",
    createdBy: by,
    createdByName: by,
    updatedBy: by,
    updatedAt: serverTimestamp(),
    ...over,
  });

  test("a crew member can draw one and claim it", async () => {
    await assertSucceeds(addDoc(collection(alice, "territories"), territoryDoc("alice")));
    await assertSucceeds(
      updateDoc(doc(bob, "territories/t1"), {
        assignedTo: ["bob"],
        updatedBy: "bob",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test("a shape that encloses nothing is refused", async () => {
    // Two points is a line. Saved, it would draw as nothing and silently own
    // no ground while looking like a territory in the list.
    await assertFails(
      addDoc(collection(alice, "territories"), territoryDoc("alice", { boundary: square.slice(0, 2) })),
    );
    await assertFails(
      addDoc(collection(alice, "territories"), territoryDoc("alice", { boundary: [] })),
    );
    await assertFails(
      addDoc(collection(alice, "territories"), territoryDoc("alice", { boundary: "square" })),
    );
  });

  test("a runaway outline cannot be written", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ lat: 38 + i / 1000, lng: -85 }));
    await assertFails(
      addDoc(collection(alice, "territories"), territoryDoc("alice", { boundary: tooMany })),
    );
  });

  test("it cannot be attributed to somebody else", async () => {
    await assertFails(addDoc(collection(alice, "territories"), territoryDoc("bob")));
  });

  test("redrawing a boundary has to say who did it", async () => {
    await assertFails(updateDoc(doc(bob, "territories/t1"), { boundary: square }));
  });

  test("an unauthenticated caller gets nothing", async () => {
    await assertFails(getDocs(collection(anon, "territories")));
    await assertFails(addDoc(collection(anon, "territories"), territoryDoc("alice")));
  });
});


/* ------------------------------------------------------- open registration */

/**
 * Sign-up is open to anybody, so these rules are the only thing between a
 * stranger with an email address and every customer's home address.
 *
 * The escalation being tested is two steps long and obvious once you see it:
 * register, then write `role: 'crew'` onto your own profile. Everything else
 * in this file is a variation on making sure that cannot happen — including
 * through the side doors, like renaming yourself while setting the role, or
 * having a friendly pending account promote another one.
 */
describe("registration grants nothing", () => {
  test("a pending account cannot read customers", async () => {
    await assertFails(getDoc(doc(mallory, "customers/c1")));
    await assertFails(getDocs(collection(mallory, "customers")));
  });

  test("a pending account cannot read money, jobs or messages", async () => {
    await assertFails(getDoc(doc(mallory, "documents/d1")));
    await assertFails(getDoc(doc(mallory, "jobs/j1")));
    await assertFails(getDoc(doc(mallory, "territories/t1")));
  });

  test("a pending account cannot write anything", async () => {
    await assertFails(
      addDoc(collection(mallory, "customers"), customerDoc("mallory")),
    );
  });

  test("an account with no profile at all is refused", async () => {
    // The instant after registering, before the profile write lands. `get` on
    // a missing document is an error in rules, and an unguarded lookup would
    // take every rule down with it rather than denying this one caller.
    await assertFails(getDoc(doc(newbie, "customers/c1")));
  });
});

describe("the escalation", () => {
  test("a pending account cannot promote itself", async () => {
    // The whole attack, in one line.
    await assertFails(updateDoc(doc(mallory, "users/mallory"), { role: "crew" }));
  });

  test("...nor by writing role alongside something legitimate", async () => {
    // Hiding it in a normal-looking profile save must not slip past a rule
    // that only inspects some of the keys.
    await assertFails(
      updateDoc(doc(mallory, "users/mallory"), {
        displayName: "Mallory",
        phone: "5025550100",
        role: "crew",
      }),
    );
  });

  test("...nor by re-creating the document", async () => {
    await assertFails(
      setDoc(doc(mallory, "users/mallory"), { displayName: "Mallory", role: "crew" }),
    );
  });

  test("...nor by promoting a second account it controls", async () => {
    await assertFails(updateDoc(doc(mallory, "users/newbie"), { role: "crew" }));
  });

  test("a brand new account may only register itself as pending", async () => {
    await assertFails(
      setDoc(doc(newbie, "users/newbie"), { displayName: "New", role: "crew" }),
    );
    await assertSucceeds(
      setDoc(doc(newbie, "users/newbie"), { displayName: "New", role: "pending" }),
    );
  });

  test("a new account cannot create somebody else's profile", async () => {
    await assertFails(
      setDoc(doc(newbie, "users/someone-else"), { displayName: "X", role: "pending" }),
    );
  });
});

describe("what a pending account can still do", () => {
  test("reads its own profile", async () => {
    // Without this the app could only show a blank screen to somebody who has
    // just registered, instead of telling them they are waiting.
    await assertSucceeds(getDoc(doc(mallory, "users/mallory")));
  });

  test("edits its own name and phone", async () => {
    await assertSucceeds(
      updateDoc(doc(mallory, "users/mallory"), {
        displayName: "Mallory B",
        phone: "5025550111",
      }),
    );
  });

  test("cannot read anybody else's profile", async () => {
    await assertFails(getDoc(doc(mallory, "users/alice")));
  });
});

describe("approving somebody", () => {
  test("the admin can let a pending account in", async () => {
    await assertSucceeds(updateDoc(doc(admin, "users/mallory"), { role: "crew" }));
  });

  test("the admin can put them back out", async () => {
    await assertSucceeds(updateDoc(doc(admin, "users/dana"), { role: "pending" }));
  });

  test("approving may change the role and nothing else", async () => {
    // An approver has no business renaming the account they are letting in,
    // or moving its map dot.
    await assertFails(
      updateDoc(doc(admin, "users/mallory"), { role: "crew", displayName: "Hacked" }),
    );
    await assertFails(updateDoc(doc(admin, "users/mallory"), { displayName: "Hacked" }));
  });

  test("an approved account is crew everywhere", async () => {
    // Dana is crew by stored role, not by uid. If the rules only honoured the
    // hardcoded list, approving somebody would appear to work and change
    // nothing they could actually do.
    await assertSucceeds(getDoc(doc(dana, "customers/c1")));
    await assertSucceeds(addDoc(collection(dana, "customers"), customerDoc("dana")));
  });
});

describe("only the admin hands out access", () => {
  // The whole point of this tier. Alice and Bob are founding crew with full
  // run of the app; Dana is approved crew. None of them is the admin, and none
  // of them may change anybody's role. Hiding the UI is the courtesy — these
  // are the enforcement.
  test("a founding crew member cannot approve anyone", async () => {
    await assertFails(updateDoc(doc(alice, "users/mallory"), { role: "crew" }));
    await assertFails(updateDoc(doc(bob, "users/mallory"), { role: "crew" }));
  });

  test("a founding crew member cannot revoke anyone", async () => {
    await assertFails(updateDoc(doc(alice, "users/dana"), { role: "pending" }));
  });

  test("an approved crew member cannot approve anyone", async () => {
    await assertFails(updateDoc(doc(dana, "users/mallory"), { role: "crew" }));
  });

  test("crew keep every other power they had", async () => {
    // "Don't change Noah's permissions" — losing the ability to grant access
    // must not cost him anything else.
    await assertSucceeds(getDoc(doc(bob, "customers/c1")));
    await assertSucceeds(addDoc(collection(bob, "customers"), customerDoc("bob")));
    await assertSucceeds(getDoc(doc(bob, "documents/d1")));
    await assertSucceeds(updateDoc(doc(bob, "users/bob"), { displayName: "Bob P" }));
  });

  test("an impostor email does not make you admin", async () => {
    const nearly = testEnv
      .authenticatedContext("impostor", { email: "nicolas.grimebustersky@evil.com" })
      .firestore();
    await assertFails(updateDoc(doc(nearly, "users/mallory"), { role: "crew" }));
  });

  test("the admin email does not need a stored role", async () => {
    // Admin is derived from the token, never from the database — so it works
    // with no profile document at all, and cannot be granted by a write.
    await assertSucceeds(getDoc(doc(admin, "customers/c1")));
  });
});

describe("the bootstrap accounts", () => {
  test("are crew with no role field stored", async () => {
    await assertSucceeds(getDoc(doc(alice, "customers/c1")));
    await assertSucceeds(getDoc(doc(bob, "customers/c1")));
  });

  test("stay crew even if their profile says pending", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/alice"), {
        displayName: "Alice",
        role: "pending",
      });
    });
    await assertSucceeds(getDoc(doc(alice, "customers/c1")));
  });

  test("stay crew even with no profile document at all", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), "users/alice"));
    });
    await assertSucceeds(getDoc(doc(alice, "customers/c1")));
  });
});
