#!/usr/bin/env node
/**
 * Everything that can be automated once the Firebase console steps are done.
 *
 * The console steps this cannot do for you, because a service-account key does
 * not carry permission to provision infrastructure:
 *
 *   1. Firestore → create a database named exactly "(default)".
 *      Standard edition. Any single region (us-east1 is closest to Kentucky).
 *   2. Authentication → Get started → enable Email/Password, then add the two
 *      crew accounts under Users.
 *   3. Storage → Get started (optional; only job photos depend on it).
 *
 * What this script then does:
 *
 *   - checks all three and tells you exactly which are missing
 *   - reads the two crew uids straight out of Firebase Auth
 *   - writes them into firestore.rules in place of the placeholders
 *   - deploys the Firestore rules and indexes, and the Storage rules
 *   - writes one document as the Admin SDK, reads it back and deletes it, so
 *     you know the wiring works rather than assuming it
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/finish-firebase-setup.mjs
 *
 * Add --dry-run to check the state and print the uids without writing or
 * deploying anything.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULES_PATH = path.join(ROOT, "firestore.rules");
const PLACEHOLDERS = ["REPLACE_WITH_FIRST_UID", "REPLACE_WITH_SECOND_UID"];
const DRY_RUN = process.argv.includes("--dry-run");

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON.");
  process.exit(1);
}

const sa = JSON.parse(readFileSync(keyPath, "utf8"));
const projectId = sa.project_id;
initializeApp({
  credential: cert(sa),
  projectId,
  storageBucket: `${projectId}.firebasestorage.app`,
});

const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => console.log(`  --   ${m}`);

console.log(`\nProject: ${projectId}${DRY_RUN ? "  (dry run)" : ""}\n`);

// ---------------------------------------------------------------- preflight
console.log("Checking what exists:");

let firestoreReady = false;
try {
  await getFirestore().collection("__setup_probe").limit(1).get();
  firestoreReady = true;
  ok("Firestore (default) database");
} catch {
  bad('Firestore (default) database — create one named exactly "(default)"');
}

let users = [];
let authReady = false;
try {
  users = (await getAuth().listUsers(1000)).users;
  authReady = true;
  ok(`Authentication enabled — ${users.length} account(s)`);
} catch {
  bad("Authentication — enable the Email/Password provider");
}

let storageReady = false;
try {
  [storageReady] = await getStorage().bucket().exists();
  storageReady ? ok("Storage bucket") : bad("Storage bucket — optional, job photos only");
} catch {
  bad("Storage bucket — optional, job photos only");
}

if (!firestoreReady || !authReady) {
  console.log("\nFinish the console steps above, then run this again.\n");
  process.exit(1);
}

// ---------------------------------------------------------------- uids
// The rules allowlist is the whole access-control model: two uids, everyone
// else refused. Guessing which accounts belong to the crew would be a bad way
// to decide that, so anything other than exactly two accounts stops here.
if (users.length !== 2) {
  console.log(
    `\nExpected exactly 2 crew accounts, found ${users.length}. ` +
      `The allowlist is written by hand in that case — see firestore.rules.\n`,
  );
  for (const u of users) console.log(`  ${u.uid}  ${u.email ?? "(no email)"}`);
  process.exit(1);
}

const [first, second] = users;
console.log("\nCrew accounts:");
console.log(`  ${first.uid}  ${first.email ?? ""}`);
console.log(`  ${second.uid}  ${second.email ?? ""}`);

// ---------------------------------------------------------------- allowlist
let rules = readFileSync(RULES_PATH, "utf8");
const stillPlaceheld = PLACEHOLDERS.some((p) => rules.includes(p));

if (stillPlaceheld) {
  rules = rules
    .replaceAll(PLACEHOLDERS[0], first.uid)
    .replaceAll(PLACEHOLDERS[1], second.uid);
  if (DRY_RUN) {
    console.log("\nWould write both uids into firestore.rules.");
  } else {
    writeFileSync(RULES_PATH, rules);
    console.log("\nWrote both uids into firestore.rules.");
  }
} else if (rules.includes(first.uid) && rules.includes(second.uid)) {
  console.log("\nfirestore.rules already lists both uids.");
} else {
  console.log(
    "\nfirestore.rules has no placeholders but does not list these uids. " +
      "Left untouched — check it by hand before deploying.",
  );
}

if (DRY_RUN) {
  console.log("\nDry run: nothing deployed.\n");
  process.exit(0);
}

// ---------------------------------------------------------------- deploy
const targets = ["firestore:rules", "firestore:indexes"];
if (storageReady) targets.push("storage");

console.log(`\nDeploying: ${targets.join(", ")}`);
try {
  execFileSync(
    "npx",
    ["-y", "firebase-tools@latest", "deploy", "--only", targets.join(","), "--project", projectId],
    { stdio: "inherit", cwd: ROOT },
  );
} catch {
  console.error("\nDeploy failed. The output above says why.\n");
  process.exit(1);
}

// ---------------------------------------------------------------- smoke test
// The Admin SDK bypasses security rules, so this proves the database is
// reachable and writable — not that the rules are correct. The rules are
// covered by `npm run test:rules` against the emulator.
console.log("\nSmoke test:");
const db = getFirestore();
const ref = db.collection("__setup_probe").doc("probe");
try {
  await ref.set({ at: new Date().toISOString(), by: "finish-firebase-setup" });
  const snap = await ref.get();
  if (!snap.exists) throw new Error("write succeeded but read came back empty");
  ok("wrote, read back and verified a document");
  await ref.delete();
  ok("cleaned it up");
} catch (error) {
  console.error(`  --   ${error.message}`);
  process.exit(1);
}

console.log(`
Done. Remaining, in order:

  1. Firebase console → Authentication → Settings → Authorised domains
     → add your Vercel domain, or sign-in fails with auth/unauthorized-domain.
  2. Vercel → Environment Variables → add the six NEXT_PUBLIC_FIREBASE_* values,
     the Maps key, and CREW_UIDS=${first.uid},${second.uid}
  3. Remove NEXT_PUBLIC_DEMO_MODE from any environment you want running on real
     data, then redeploy — it is read at build time.
  4. Commit the updated firestore.rules.
`);
