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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, before, after, describe } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A tiny stand-in for a photo. Content type is what the rules actually check. */
const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const IMAGE = { contentType: "image/jpeg" };

let testEnv;
let alice;
let bob;
let mallory;
let anon;

before(async () => {
  const rules = readFileSync(join(repoRoot, "storage.rules"), "utf8")
    .replace("REPLACE_WITH_FIRST_UID", "alice")
    .replace("REPLACE_WITH_SECOND_UID", "bob");

  testEnv = await initializeTestEnvironment({
    projectId: "gb-rules-test",
    storage: { rules, host: "127.0.0.1", port: 9199 },
  });

  await testEnv.clearStorage();

  alice = testEnv.authenticatedContext("alice").storage();
  bob = testEnv.authenticatedContext("bob").storage();
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
