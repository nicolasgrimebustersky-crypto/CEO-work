/**
 * Security-rules tests for storage.rules, run against the Storage emulator.
 *
 *   npm run test:rules
 *
 * Job photos are the only thing in the bucket, and they are customers' homes —
 * driveways, house numbers, sometimes the customer. The same two-account
 * allowlist that guards Firestore has to guard these, and the size and
 * content-type caps have to actually hold.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, before, after, describe } from "node:test";

import { rulesWithTestCrew } from "./rulesSource.mjs";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { doc, setDoc } from "firebase/firestore";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A tiny stand-in for a photo. Content type is what the rules actually check. */
const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const IMAGE = { contentType: "image/jpeg" };

let testEnv;
/** A sign-in that has entered its code — see the same constant in the Firestore tests. */
const SIGNED_IN_AT = 1_700_000_000;
const VERIFIED = { auth_time: SIGNED_IN_AT, otpAuths: [SIGNED_IN_AT] };
let alice;
let bob;
let mallory;
let anon;

before(async () => {
  const rules = rulesWithTestCrew(join(repoRoot, "storage.rules"));

  testEnv = await initializeTestEnvironment({
    // The Storage emulator reads crew profiles for its cross-service rules
    // from the Firestore emulator under the id `firebase emulators:exec`
    // started with (handed over as GCLOUD_PROJECT), so this suite uses it.
    projectId: process.env.GCLOUD_PROJECT || "gb-rules-test",
    storage: { rules, host: "127.0.0.1", port: 9199 },
    firestore: {
      rules: rulesWithTestCrew(join(repoRoot, "firestore.rules")),
      host: "127.0.0.1",
      port: 8080,
    },
  });

  await testEnv.clearStorage();
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Approved on the Account screen: role 'crew', not on any list.
    await setDoc(doc(db, "users/carol"), { displayName: "Carol", role: "crew" });
    // Signed up, not yet approved — or approved once and since removed.
    await setDoc(doc(db, "users/dave"), { displayName: "Dave", role: "pending" });
  });

  alice = testEnv.authenticatedContext("alice", VERIFIED).storage();
  bob = testEnv.authenticatedContext("bob", VERIFIED).storage();
  mallory = testEnv.authenticatedContext("mallory").storage();
  anon = testEnv.unauthenticatedContext().storage();
});

after(async () => {
  await testEnv?.cleanup();
});

describe("job photos", () => {
  test("a crew member can upload, read back and delete a photo", async () => {
    const path = "jobs/j1/before-1.jpg";
    await assertSucceeds(uploadBytes(ref(alice, path), IMAGE_BYTES, IMAGE));
    // The other crew member sees it too — same shared job record.
    await assertSucceeds(getDownloadURL(ref(bob, path)));
    // Delete is a separate rule because request.resource is null on a delete;
    // folding it into the upload rule would fail the size check every time.
    await assertSucceeds(deleteObject(ref(bob, path)));
  });

  test("a crew sign-in that has not entered its code cannot upload or read", async () => {
    // Same person, same allowlist, a fresh password sign-in with no code yet.
    // Photos are customers' houses; the second step applies here too.
    const path = "jobs/j1/before-1.jpg";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), IMAGE_BYTES, IMAGE);
    });
    const aliceFresh = testEnv
      .authenticatedContext("alice", { auth_time: SIGNED_IN_AT + 5000 })
      .storage();
    await assertFails(uploadBytes(ref(aliceFresh, "jobs/j1/after-1.jpg"), IMAGE_BYTES, IMAGE));
    await assertFails(getDownloadURL(ref(aliceFresh, path)));
    await assertFails(deleteObject(ref(aliceFresh, path)));
  });

  test("an account off the allowlist cannot upload or read", async () => {
    const path = "jobs/j2/before-1.jpg";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), IMAGE_BYTES, IMAGE);
    });

    await assertFails(uploadBytes(ref(mallory, "jobs/j2/sneaky.jpg"), IMAGE_BYTES, IMAGE));
    await assertFails(getDownloadURL(ref(mallory, path)));
    await assertFails(deleteObject(ref(mallory, path)));
  });

  test("an unauthenticated caller cannot upload or read", async () => {
    await assertFails(uploadBytes(ref(anon, "jobs/j3/x.jpg"), IMAGE_BYTES, IMAGE));
    await assertFails(getDownloadURL(ref(anon, "jobs/j2/before-1.jpg")));
  });

  test("non-image uploads are refused", async () => {
    await assertFails(
      uploadBytes(ref(alice, "jobs/j1/notes.pdf"), IMAGE_BYTES, {
        contentType: "application/pdf",
      }),
    );
    await assertFails(
      uploadBytes(ref(alice, "jobs/j1/payload.html"), IMAGE_BYTES, {
        contentType: "text/html",
      }),
    );
  });

  test("uploads over the 15 MB cap are refused", async () => {
    const tooBig = new Uint8Array(16 * 1024 * 1024);
    await assertFails(uploadBytes(ref(alice, "jobs/j1/huge.jpg"), tooBig, IMAGE));
  });

  test("paths outside jobs/ are denied entirely", async () => {
    await assertFails(uploadBytes(ref(alice, "loose-file.jpg"), IMAGE_BYTES, IMAGE));
    await assertFails(
      uploadBytes(ref(alice, "customers/c1/photo.jpg"), IMAGE_BYTES, IMAGE),
    );
    // Nested deeper than jobs/{jobId}/{fileName} does not match the rule either.
    await assertFails(
      uploadBytes(ref(alice, "jobs/j1/nested/photo.jpg"), IMAGE_BYTES, IMAGE),
    );
  });
});

test("the owner is crew here too, as in firestore.rules", async () => {
  const owner = testEnv
    .authenticatedContext("nicolas", { email: "nicolas.grimebustersky@gmail.com", ...VERIFIED })
    .storage();
  await assertSucceeds(uploadBytes(ref(owner, "jobs/j9/before-1.jpg"), IMAGE_BYTES, IMAGE));
  // The email alone, without this sign-in's code, is not enough.
  const ownerNoCode = testEnv
    .authenticatedContext("nicolas", { email: "nicolas.grimebustersky@gmail.com" })
    .storage();
  await assertFails(uploadBytes(ref(ownerNoCode, "jobs/j9/before-2.jpg"), IMAGE_BYTES, IMAGE));
});

describe("expense receipts", () => {
  const PDF = { contentType: "application/pdf" };
  let owner;
  before(() => {
    owner = testEnv
      .authenticatedContext("nicolas", { email: "nicolas.grimebustersky@gmail.com", ...VERIFIED })
      .storage();
  });

  test("a crew member can file a receipt photo or PDF under their own name, read it and delete it", async () => {
    await assertSucceeds(uploadBytes(ref(alice, "expenses/alice/x1/receipt-1.jpg"), IMAGE_BYTES, IMAGE));
    await assertSucceeds(uploadBytes(ref(alice, "expenses/alice/x1/receipt-2.pdf"), IMAGE_BYTES, PDF));
    await assertSucceeds(getDownloadURL(ref(alice, "expenses/alice/x1/receipt-1.jpg")));
    await assertSucceeds(deleteObject(ref(alice, "expenses/alice/x1/receipt-1.jpg")));
  });

  test("another crew member cannot open, add to or delete someone else's receipts", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "expenses/alice/x2/receipt-1.jpg"), IMAGE_BYTES, IMAGE);
    });
    await assertFails(getDownloadURL(ref(bob, "expenses/alice/x2/receipt-1.jpg")));
    await assertFails(uploadBytes(ref(bob, "expenses/alice/x2/sneaky.jpg"), IMAGE_BYTES, IMAGE));
    await assertFails(deleteObject(ref(bob, "expenses/alice/x2/receipt-1.jpg")));
  });

  test("the owner can open and replace anyone's receipts", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "expenses/alice/x3/receipt-1.jpg"), IMAGE_BYTES, IMAGE);
    });
    await assertSucceeds(getDownloadURL(ref(owner, "expenses/alice/x3/receipt-1.jpg")));
    await assertSucceeds(uploadBytes(ref(owner, "expenses/alice/x3/receipt-2.jpg"), IMAGE_BYTES, IMAGE));
    await assertSucceeds(deleteObject(ref(owner, "expenses/alice/x3/receipt-1.jpg")));
  });

  test("outsiders cannot upload or read receipts", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "expenses/alice/x4/receipt-1.jpg"), IMAGE_BYTES, IMAGE);
    });
    await assertFails(uploadBytes(ref(mallory, "expenses/mallory/x4/sneaky.jpg"), IMAGE_BYTES, IMAGE));
    await assertFails(getDownloadURL(ref(mallory, "expenses/alice/x4/receipt-1.jpg")));
    await assertFails(getDownloadURL(ref(anon, "expenses/alice/x4/receipt-1.jpg")));
  });

  test("only images and PDFs, under 15 MB", async () => {
    await assertFails(uploadBytes(ref(alice, "expenses/alice/x5/r.html"), IMAGE_BYTES, { contentType: "text/html" }));
    const tooBig = new Uint8Array(16 * 1024 * 1024);
    await assertFails(uploadBytes(ref(alice, "expenses/alice/x5/huge.jpg"), tooBig, IMAGE));
  });
});

describe("W-9s", () => {
  test("only the owner uploads, opens or deletes one — not even the person it is for", async () => {
    const owner = testEnv
      .authenticatedContext("nicolas", { email: "nicolas.grimebustersky@gmail.com", ...VERIFIED })
      .storage();
    const path = "w9/alice/w9-1.pdf";
    await assertFails(uploadBytes(ref(alice, path), IMAGE_BYTES, { contentType: "application/pdf" }));
    await assertSucceeds(uploadBytes(ref(owner, path), IMAGE_BYTES, { contentType: "application/pdf" }));
    await assertSucceeds(getDownloadURL(ref(owner, path)));
    await assertFails(getDownloadURL(ref(alice, path)));
    await assertFails(getDownloadURL(ref(bob, path)));
    await assertFails(getDownloadURL(ref(mallory, path)));
    await assertFails(deleteObject(ref(alice, path)));
    await assertFails(uploadBytes(ref(owner, "w9/alice/w9.html"), IMAGE_BYTES, { contentType: "text/html" }));
    await assertSucceeds(deleteObject(ref(owner, path)));
  });
});

describe("approved hires", () => {
  test("anyone the owner approved can upload, read and delete job photos — no rules change per hire", async () => {
    const carol = testEnv.authenticatedContext("carol", VERIFIED).storage();
    await assertSucceeds(uploadBytes(ref(carol, "jobs/j4/before-1.jpg"), IMAGE_BYTES, IMAGE));
    await assertSucceeds(getDownloadURL(ref(alice, "jobs/j4/before-1.jpg")));
    await assertSucceeds(deleteObject(ref(carol, "jobs/j4/before-1.jpg")));
  });

  test("an approved hire files their own receipts, and cannot open anyone else's", async () => {
    const carol = testEnv.authenticatedContext("carol", VERIFIED).storage();
    await assertSucceeds(uploadBytes(ref(carol, "expenses/carol/x1/r.jpg"), IMAGE_BYTES, IMAGE));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "expenses/alice/x9/r.jpg"), IMAGE_BYTES, IMAGE);
    });
    await assertFails(getDownloadURL(ref(carol, "expenses/alice/x9/r.jpg")));
  });

  test("an approved hire still owes this sign-in's code", async () => {
    const carolFresh = testEnv.authenticatedContext("carol", { auth_time: SIGNED_IN_AT + 5000 }).storage();
    await assertFails(uploadBytes(ref(carolFresh, "jobs/j4/x.jpg"), IMAGE_BYTES, IMAGE));
  });

  test("a pending or removed account cannot upload or read", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "jobs/j5/before-1.jpg"), IMAGE_BYTES, IMAGE);
    });
    const dave = testEnv.authenticatedContext("dave", VERIFIED).storage();
    await assertFails(uploadBytes(ref(dave, "jobs/j5/x.jpg"), IMAGE_BYTES, IMAGE));
    await assertFails(getDownloadURL(ref(dave, "jobs/j5/before-1.jpg")));
  });
});

describe("files attached to estimates and invoices", () => {
  const PDF = { contentType: "application/pdf" };
  const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 test");

  test("a crew member can attach a PDF or a photo, read it back and remove it", async () => {
    await assertSucceeds(uploadBytes(ref(alice, "documents/d1/files/scope.pdf"), PDF_BYTES, PDF));
    await assertSucceeds(uploadBytes(ref(alice, "documents/d1/files/site.jpg"), IMAGE_BYTES, IMAGE));
    await assertSucceeds(getDownloadURL(ref(bob, "documents/d1/files/scope.pdf")));
    await assertSucceeds(deleteObject(ref(bob, "documents/d1/files/scope.pdf")));
  });

  test("anything that could run in a browser is refused", async () => {
    for (const contentType of ["text/html", "image/svg+xml", "application/javascript", "application/zip"]) {
      await assertFails(
        uploadBytes(ref(alice, "documents/d1/files/x"), PDF_BYTES, { contentType }),
        contentType,
      );
    }
  });

  test("files over 20 MB are refused", async () => {
    const tooBig = new Uint8Array(21 * 1024 * 1024);
    await assertFails(uploadBytes(ref(alice, "documents/d1/files/huge.pdf"), tooBig, PDF));
  });

  test("nobody but verified crew can attach or read — customers go through the server", async () => {
    const path = "documents/d2/files/coi.pdf";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), PDF_BYTES, PDF);
    });
    const aliceFresh = testEnv
      .authenticatedContext("alice", { auth_time: SIGNED_IN_AT + 5000 })
      .storage();
    for (const ctx of [mallory, anon, aliceFresh]) {
      await assertFails(getDownloadURL(ref(ctx, path)));
      await assertFails(uploadBytes(ref(ctx, "documents/d2/files/new.pdf"), PDF_BYTES, PDF));
      await assertFails(deleteObject(ref(ctx, path)));
    }
  });

  test("only the files folder of a document is writable", async () => {
    await assertFails(uploadBytes(ref(alice, "documents/d1/scope.pdf"), PDF_BYTES, PDF));
    await assertFails(uploadBytes(ref(alice, "documents/d1/files/a/b.pdf"), PDF_BYTES, PDF));
  });
});
