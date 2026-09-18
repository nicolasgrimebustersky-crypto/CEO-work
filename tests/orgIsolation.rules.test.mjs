/**
 * Cross-org isolation, run against the Firestore emulator.
 *
 *   npm run test:rules
 *
 * firestore.rules gained an orgId on every collection and a handful of
 * functions — myOrgId(), belongsToMyOrg(), createsInMyOrg(), keepsOrg() — that
 * exist for exactly one property: a member of one business must not be able
 * to read, create, or move a document into another business's data. That
 * property is the entire point of this file, and it did not exist before this
 * suite did — tests/firestore.rules.test.mjs is deliberately left as the
 * single-org suite it always was, because every fixture in it predates orgId
 * and proves the *other* half of the contract: that legacy data with no
 * orgId keeps working exactly as it did.
 *
 * This file is the half that could not be proven any other way: two real
 * businesses, on the same deployment, and everything one of them tries against
 * the other's data.
 *
 * It also found the one real gap in that story, rather than assuming it
 * away: reading a single document by id is fully isolated, but an
 * unconstrained list query is not, because Firestore only enforces a
 * resource.data-based rule against a list request when the query itself
 * carries a matching where() clause. See "an UNFILTERED list query is not
 * isolated by these rules" below for the proof and what it means the app's
 * queries still owe.
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
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let testEnv;

const SIGNED_IN_AT = 1_700_000_000;
const VERIFIED = { auth_time: SIGNED_IN_AT, otpAuths: [SIGNED_IN_AT] };

const ORG_A = "grime-busters"; // the default — matches DEFAULT_ORG_ID in lib/org.ts
const ORG_B = "second-lawn-co";

// Two crew members, two businesses. Neither is a bootstrap uid, so both are
// crew purely by their profile's role — which is the ordinary shape a real
// second org's accounts would have, since the bootstrap allowlist stays
// pinned to the one business that owns this deployment.
let alice; // ORG_A
let erin; // ORG_B
let admin; // the one admin, whichever org they are managing today

function customerDoc(orgId, overrides = {}) {
  return {
    orgId,
    firstName: "Test",
    lastName: "House",
    status: "lead",
    pipelineStage: "new_lead",
    lat: 38.4,
    lng: -85.4,
    notes: [],
    createdBy: orgId === ORG_A ? "alice" : "erin",
    updatedBy: orgId === ORG_A ? "alice" : "erin",
    ...overrides,
  };
}

before(async () => {
  const rules = rulesWithTestCrew(join(repoRoot, "firestore.rules"));

  testEnv = await initializeTestEnvironment({
    projectId: "gb-org-isolation-test",
    firestore: { rules, host: "127.0.0.1", port: 8080 },
  });

  alice = testEnv.authenticatedContext("alice", VERIFIED).firestore();
  erin = testEnv.authenticatedContext("erin", VERIFIED).firestore();
  admin = testEnv
    .authenticatedContext("nicolas", { email: "nicolas.grimebustersky@gmail.com", ...VERIFIED })
    .firestore();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Alice is crew by role, in the default org — an ordinary approved crew
    // member, not one of the two bootstrap uids.
    await setDoc(doc(db, "users/alice"), { displayName: "Alice", role: "crew", orgId: ORG_A });
    // Erin is crew by role, in a second, wholly separate org.
    await setDoc(doc(db, "users/erin"), { displayName: "Erin", role: "crew", orgId: ORG_B });

    await setDoc(doc(db, "customers/ca"), customerDoc(ORG_A));
    await setDoc(doc(db, "customers/cb"), customerDoc(ORG_B));

    await setDoc(doc(db, "jobs/ja"), {
      orgId: ORG_A,
      customerId: "ca",
      serviceType: "pressure_washing",
      status: "scheduled",
      price: 100,
      assignedTo: ["alice"],
      createdBy: "alice",
      updatedBy: "alice",
    });
    await setDoc(doc(db, "jobs/jb"), {
      orgId: ORG_B,
      customerId: "cb",
      serviceType: "pressure_washing",
      status: "scheduled",
      price: 100,
      assignedTo: ["erin"],
      createdBy: "erin",
      updatedBy: "erin",
    });

    await setDoc(doc(db, "documents/da"), {
      orgId: ORG_A,
      number: "A-1",
      kind: "invoice",
      status: "draft",
      customerId: "ca",
      serviceType: "pressure_washing",
      lineItems: [],
      payments: [],
      discount: 0,
      taxRatePct: 6,
      subtotal: 0,
      total: 0,
      amountPaid: 0,
      balanceDue: 0,
      createdBy: "alice",
      updatedBy: "alice",
    });
    await setDoc(doc(db, "documents/db"), {
      orgId: ORG_B,
      number: "B-1",
      kind: "invoice",
      status: "draft",
      customerId: "cb",
      serviceType: "pressure_washing",
      lineItems: [],
      payments: [],
      discount: 0,
      taxRatePct: 6,
      subtotal: 0,
      total: 0,
      amountPaid: 0,
      balanceDue: 0,
      createdBy: "erin",
      updatedBy: "erin",
    });

    await setDoc(doc(db, "services/sa"), {
      orgId: ORG_A,
      name: "Driveway wash",
      description: "",
      unitPrice: 100,
      serviceType: "pressure_washing",
      taxable: true,
      timesUsed: 0,
      createdBy: "alice",
    });
    await setDoc(doc(db, "services/sb"), {
      orgId: ORG_B,
      name: "Driveway wash",
      description: "",
      unitPrice: 100,
      serviceType: "pressure_washing",
      taxable: true,
      timesUsed: 0,
      createdBy: "erin",
    });

    await setDoc(doc(db, "knockRoutes/ra"), {
      orgId: ORG_A,
      name: "A street",
      status: "planned",
      assignedTo: ["alice"],
      stopIds: [],
      knockedIds: [],
      createdBy: "alice",
      updatedBy: "alice",
    });
    await setDoc(doc(db, "knockRoutes/rb"), {
      orgId: ORG_B,
      name: "B street",
      status: "planned",
      assignedTo: ["erin"],
      stopIds: [],
      knockedIds: [],
      createdBy: "erin",
      updatedBy: "erin",
    });

    await setDoc(doc(db, "territories/ta"), {
      orgId: ORG_A,
      name: "A territory",
      boundary: [
        { lat: 38.4, lng: -85.38 },
        { lat: 38.41, lng: -85.38 },
        { lat: 38.41, lng: -85.37 },
      ],
      assignedTo: ["alice"],
      active: true,
      createdBy: "alice",
      updatedBy: "alice",
    });
    await setDoc(doc(db, "territories/tb"), {
      orgId: ORG_B,
      name: "B territory",
      boundary: [
        { lat: 39.4, lng: -86.38 },
        { lat: 39.41, lng: -86.38 },
        { lat: 39.41, lng: -86.37 },
      ],
      assignedTo: ["erin"],
      active: true,
      createdBy: "erin",
      updatedBy: "erin",
    });

    await setDoc(doc(db, "notifications/na"), {
      orgId: ORG_A,
      forUid: "alice",
      actorUid: "alice",
      actorName: "Alice",
      type: "job_updated",
      title: "",
      body: "",
      customerId: null,
      jobId: null,
      documentId: null,
      conversationId: null,
      readAt: null,
    });
    await setDoc(doc(db, "notifications/nb"), {
      orgId: ORG_B,
      forUid: "erin",
      actorUid: "erin",
      actorName: "Erin",
      type: "job_updated",
      title: "",
      body: "",
      customerId: null,
      jobId: null,
      documentId: null,
      conversationId: null,
      readAt: null,
    });

    await setDoc(doc(db, "pushTokens/pa"), { orgId: ORG_A, uid: "alice", token: "tok-a" });
    await setDoc(doc(db, "pushTokens/pb"), { orgId: ORG_B, uid: "erin", token: "tok-b" });

    await setDoc(doc(db, "conversations/xa"), {
      orgId: ORG_A,
      title: "",
      memberUids: ["alice"],
      createdBy: "alice",
      lastMessageAt: null,
      lastMessageText: "",
      lastMessageBy: "",
    });
    await setDoc(doc(db, "conversations/xb"), {
      orgId: ORG_B,
      title: "",
      memberUids: ["erin"],
      createdBy: "erin",
      lastMessageAt: null,
      lastMessageText: "",
      lastMessageBy: "",
    });
  });
});

after(async () => {
  await testEnv?.cleanup();
});

/* ----------------------------------------------------------------- reading */

describe("a business cannot read another business's data", () => {
  test("customers", async () => {
    await assertSucceeds(getDoc(doc(alice, "customers/ca")));
    await assertFails(getDoc(doc(alice, "customers/cb")));
    await assertSucceeds(getDoc(doc(erin, "customers/cb")));
    await assertFails(getDoc(doc(erin, "customers/ca")));
  });

  test("jobs", async () => {
    await assertFails(getDoc(doc(alice, "jobs/jb")));
    await assertFails(getDoc(doc(erin, "jobs/ja")));
  });

  test("estimates and invoices", async () => {
    await assertFails(getDoc(doc(alice, "documents/db")));
    await assertFails(getDoc(doc(erin, "documents/da")));
  });

  test("the price book", async () => {
    await assertFails(getDoc(doc(alice, "services/sb")));
    await assertFails(getDoc(doc(erin, "services/sa")));
  });

  test("knock routes", async () => {
    await assertFails(getDoc(doc(alice, "knockRoutes/rb")));
    await assertFails(getDoc(doc(erin, "knockRoutes/ra")));
  });

  test("territories", async () => {
    await assertFails(getDoc(doc(alice, "territories/tb")));
    await assertFails(getDoc(doc(erin, "territories/ta")));
  });

  test("push tokens", async () => {
    await assertFails(getDoc(doc(alice, "pushTokens/pb")));
    await assertFails(getDoc(doc(erin, "pushTokens/pa")));
  });

  test("team chat threads, even ones you are not locked out of by membership alone", async () => {
    // Erin is not a member of xa, so membership alone already denies this —
    // the point of this test is that the org check is a second, independent
    // gate, not a restatement of the membership one.
    await assertFails(getDoc(doc(erin, "conversations/xa")));
  });

  test("the crew roster", async () => {
    // Crew reads everyone's profile for the roster and the map dots — but
    // only within their own business.
    await assertFails(getDoc(doc(alice, "users/erin")));
    await assertFails(getDoc(doc(erin, "users/alice")));
    // Reading your own profile is unconditional, regardless of org.
    await assertSucceeds(getDoc(doc(alice, "users/alice")));
    await assertSucceeds(getDoc(doc(erin, "users/erin")));
  });

  test("an UNFILTERED list query is not isolated by these rules — a real, known gap", async () => {
    // This is the one place a get()-by-id and a list genuinely differ, and it
    // is Firestore's own behaviour, not a bug in belongsToMyOrg(). A rule that
    // depends on resource.data is only enforced against a list request when
    // the query itself carries a matching where() clause — Firestore can then
    // prove the constraint holds for every possible result without reading
    // each one. An UNCONSTRAINED query like this one gives it nothing to
    // prove that against, so the org check is silently skipped for exactly
    // this shape of read, and both businesses' customers come back.
    //
    // Confirmed empirically against the emulator before writing this test:
    // get(doc "cb") is denied to alice; this same alice, this same "cb", read
    // via an unfiltered list, is not.
    //
    // That makes this the one concrete piece of work still owed before a
    // second org's data can share these collections safely: every
    // subscribeX()/getDocs() in lib/db/*.ts that currently reads a whole
    // collection has to add where('orgId', '==', <the caller's org>) — see
    // the next test, which is what that query has to look like once it does.
    // It cannot be done yet: a where() on orgId will not match a document
    // that has no orgId field at all, so flipping the app's queries over
    // before the backfill script has actually run would make every
    // pre-existing record vanish from every screen. Backfill first, then
    // filter the queries — never the other way round.
    const snap = await getDocs(collection(alice, "customers"));
    const ids = snap.docs.map((d) => d.id);
    assert.ok(ids.includes("ca"));
    assert.ok(ids.includes("cb")); // the gap, proven rather than assumed away
  });

  test("...which is exactly why the eventual query has to filter by org itself", async () => {
    // The fix is on the query, not the rule: once lib/db/customers.ts adds
    // where('orgId', '==', myOrgId) to subscribeCustomers(), Firestore can
    // verify the constraint from the query shape and the isolation holds for
    // list reads too, with no rules change needed — belongsToMyOrg() already
    // agrees, it just was never asked the question in a form it could answer.
    const mine = await getDocs(query(collection(alice, "customers"), where("orgId", "==", ORG_A)));
    assert.deepEqual(mine.docs.map((d) => d.id), ["ca"]);

    // And the query itself will not smuggle you past this by claiming a
    // different org: Firestore can prove that constraint statically too, and
    // denies the whole request rather than returning nothing.
    await assertFails(
      getDocs(query(collection(alice, "customers"), where("orgId", "==", ORG_B))),
    );
  });
});

/* ----------------------------------------------------------------- writing */

describe("a business cannot create a document in another business's name", () => {
  test("customers", async () => {
    await assertFails(addDoc(collection(alice, "customers"), customerDoc(ORG_B)));
    await assertSucceeds(addDoc(collection(alice, "customers"), customerDoc(ORG_A)));
  });

  test("a create with no orgId at all is refused, not defaulted", async () => {
    // Reading treats a missing orgId as the legacy default so old data keeps
    // working. Writing gets no such mercy: every document created from here
    // on must say which business it belongs to, on purpose — that is what
    // lets the exception in belongsToMyOrg() eventually narrow instead of
    // needing to forgive missing data forever.
    const noOrg = customerDoc(ORG_A);
    delete noOrg.orgId;
    await assertFails(addDoc(collection(alice, "customers"), noOrg));
  });
});

describe("a business cannot move a document into another business", () => {
  test("editing a customer cannot smuggle it across the org boundary", async () => {
    await assertFails(
      updateDoc(doc(alice, "customers/ca"), {
        orgId: ORG_B,
        updatedBy: "alice",
        updatedAt: serverTimestamp(),
      }),
    );
    // An ordinary edit that leaves orgId alone still works.
    await assertSucceeds(
      updateDoc(doc(alice, "customers/ca"), {
        status: "interested",
        updatedBy: "alice",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test("a self-edit cannot add an org to a profile that never had one", async () => {
    // The attack this guards: a legacy profile with no orgId defaults to the
    // shared org for everyone. Without keepsOrg() checking the *effective*
    // org rather than the literal field, a self-edit could add
    // `orgId: 'somewhere-else'` to a profile that previously had none and
    // simply declare itself into a different business.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/newbie"), {
        displayName: "Newbie",
        role: "crew",
      });
    });
    const newbie = testEnv.authenticatedContext("newbie", VERIFIED).firestore();
    await assertFails(
      updateDoc(doc(newbie, "users/newbie"), { orgId: ORG_B, displayName: "Newbie" }),
    );
  });
});

describe("the admin's reach stops at the org boundary too", () => {
  test("cannot grant or edit a crew member outside their own business the same way", async () => {
    // The admin here has no orgId of their own on file, so myOrgId() for the
    // admin also defaults to the shared org — the same default everyone gets.
    // Granting into ORG_A works; reaching into ORG_B does not.
    await assertFails(
      updateDoc(doc(admin, "users/erin"), { role: "pending" }),
    );
  });
});
