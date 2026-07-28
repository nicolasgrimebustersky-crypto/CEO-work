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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, before, after, describe } from "node:test";

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
let anon;

function customerDoc(uid) {
  return {
    firstName: "Test",
    lastName: "House",
    status: "lead",
    lat: 38.4,
    lng: -85.4,
    notes: [],
    createdBy: uid,
    updatedBy: uid,
  };
}

before(async () => {
  const rules = readFileSync(join(repoRoot, "firestore.rules"), "utf8")
    .replace("REPLACE_WITH_FIRST_UID", "alice")
    .replace("REPLACE_WITH_SECOND_UID", "bob");

  testEnv = await initializeTestEnvironment({
    projectId: "gb-rules-test",
    firestore: { rules, host: "127.0.0.1", port: 8080 },
  });

  await testEnv.clearFirestore();

  alice = testEnv.authenticatedContext("alice").firestore();
  bob = testEnv.authenticatedContext("bob").firestore();
  mallory = testEnv.authenticatedContext("mallory").firestore();
  anon = testEnv.unauthenticatedContext().firestore();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "customers/c1"), customerDoc("alice"));
    await setDoc(doc(ctx.firestore(), "users/alice"), { displayName: "Alice" });
    await setDoc(doc(ctx.firestore(), "users/bob"), { displayName: "Bob" });
  });
});

after(async () => {
  await testEnv?.cleanup();
});

describe("the two-account allowlist", () => {
  test("a crew account can read and write customers", async () => {
    await assertSucceeds(addDoc(collection(alice, "customers"), customerDoc("alice")));
    await assertSucceeds(getDocs(collection(bob, "customers")));
  });

  test("a signed-in account that is not on the allowlist gets nothing", async () => {
    await assertFails(getDocs(collection(mallory, "customers")));
    await assertFails(addDoc(collection(mallory, "customers"), customerDoc("mallory")));
    await assertFails(getDocs(collection(mallory, "users")));
    await assertFails(addDoc(collection(mallory, "jobs"), { customerId: "x" }));
    await assertFails(addDoc(collection(mallory, "quotes"), { customerId: "x" }));
  });

  test("an unauthenticated caller gets nothing", async () => {
    await assertFails(getDocs(collection(anon, "customers")));
    await assertFails(addDoc(collection(anon, "customers"), customerDoc("alice")));
  });

  test("collections that are not listed in the rules are denied outright", async () => {
    await assertFails(addDoc(collection(alice, "secrets"), { x: 1 }));
  });
});

describe("author stamps", () => {
  test("a customer cannot be created under someone else's name", async () => {
    await assertFails(addDoc(collection(alice, "customers"), customerDoc("bob")));
  });

  test("an update must be stamped by the caller", async () => {
    await assertSucceeds(
      updateDoc(doc(bob, "customers/c1"), {
        status: "quoted",
        updatedBy: "bob",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(bob, "customers/c1"), {
        status: "quoted",
        updatedBy: "alice",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test("an update that does not refresh the stamp is rejected", async () => {
    // `request.resource.data` is the merged document on an update, so a payload
    // that omits `updatedBy` inherits the stored value. The rules require
    // `updatedAt` in the diff specifically to close that path.
    await assertFails(updateDoc(doc(bob, "customers/c1"), { status: "customer" }));
    await assertFails(
      updateDoc(doc(bob, "customers/c1"), { status: "customer", updatedBy: "bob" }),
    );
  });
});

describe("user profiles", () => {
  test("crew can read each other's profile, which is what draws the map dots", async () => {
    const snap = await assertSucceeds(getDoc(doc(alice, "users/bob")));
    assert.equal(snap.data().displayName, "Bob");
  });

  test("an account may only write its own profile and location", async () => {
    await assertSucceeds(updateDoc(doc(alice, "users/alice"), { currentLat: 38.4 }));
    await assertFails(updateDoc(doc(alice, "users/bob"), { currentLat: 0 }));
  });

  test("profiles cannot be deleted", async () => {
    await assertFails(deleteDoc(doc(alice, "users/bob")));
  });
});
