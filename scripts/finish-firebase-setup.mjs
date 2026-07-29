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
 *
 * Add --rules-only to deploy the rules and indexes without waiting for the
 * crew accounts to exist. Worth doing the moment the database is created: a
 * database left in test mode is readable by anyone on the internet, and these
 * rules with the placeholders still in them deny everyone, which is the right
 * way to fail.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { GoogleAuth } from "google-auth-library";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULES_PATH = path.join(ROOT, "firestore.rules");
const PLACEHOLDERS = ["REPLACE_WITH_FIRST_UID", "REPLACE_WITH_SECOND_UID"];
const DRY_RUN = process.argv.includes("--dry-run");
const RULES_ONLY = process.argv.includes("--rules-only");

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

if (!firestoreReady) {
  console.log('\nCreate the "(default)" database first, then run this again.\n');
  process.exit(1);
}
if (!authReady && !RULES_ONLY) {
  console.log(
    "\nEnable Authentication, then run this again." +
      "\nTo lock the database down in the meantime: --rules-only\n",
  );
  process.exit(1);
}

// ---------------------------------------------------------------- uids
// The rules allowlist is the whole access-control model: two uids, everyone
// else refused. Guessing which accounts belong to the crew would be a bad way
// to decide that, so anything other than exactly two accounts stops here.
if (!RULES_ONLY && users.length !== 2) {
  console.log(
    `\nExpected exactly 2 crew accounts, found ${users.length}. ` +
      `The allowlist is written by hand in that case — see firestore.rules.\n`,
  );
  for (const u of users) console.log(`  ${u.uid}  ${u.email ?? "(no email)"}`);
  process.exit(1);
}

const [first, second] = users.length === 2 ? users : [null, null];

if (!RULES_ONLY) {
console.log("\nCrew accounts:");
console.log(`  ${first.uid}  ${first.email ?? ""}`);
console.log(`  ${second.uid}  ${second.email ?? ""}`);
}

// ---------------------------------------------------------------- allowlist
let rules = readFileSync(RULES_PATH, "utf8");
const stillPlaceheld = PLACEHOLDERS.some((p) => rules.includes(p));

if (RULES_ONLY) {
  console.log(
    stillPlaceheld
      ? "\nRules still hold the uid placeholders, so they deny every caller. " +
          "That is the safe state until the crew accounts exist."
      : "\nRules already carry real uids.",
  );
} else if (stillPlaceheld) {
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
/**
 * Deployed over the REST APIs rather than with `firebase deploy`.
 *
 * The CLI prechecks that the underlying Google APIs are switched on, which
 * needs `serviceusage.services.get` — a permission the Firebase Admin SDK
 * service account does not hold, so the CLI refuses before it does any work.
 * The rules and index APIs themselves accept the same credential perfectly
 * well, so this talks to them directly.
 */
const googleAuth = new GoogleAuth({
  credentials: sa,
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
const accessToken = (await (await googleAuth.getClient()).getAccessToken()).token;

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

/** Uploads a rules file as a ruleset, then points the named release at it. */
async function deployRules(sourcePath, releaseId, label) {
  const content = readFileSync(path.join(ROOT, sourcePath), "utf8");

  const created = await api(
    "POST",
    `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
    { source: { files: [{ name: sourcePath, content }] } },
  );
  if (!created.ok) throw new Error(`${label}: ruleset rejected — ${created.text.slice(0, 300)}`);

  const rulesetName = JSON.parse(created.text).name;
  const releaseName = `projects/${projectId}/releases/${releaseId}`;

  // A release is created the first time and updated every time after, so try
  // the update first and fall back to create.
  let released = await api(
    "PATCH",
    `https://firebaserules.googleapis.com/v1/${releaseName}`,
    { release: { name: releaseName, rulesetName } },
  );
  if (!released.ok) {
    released = await api(
      "POST",
      `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`,
      { name: releaseName, rulesetName },
    );
  }
  if (!released.ok) throw new Error(`${label}: release failed — ${released.text.slice(0, 300)}`);

  ok(`${label} deployed`);
}

/**
 * Composite indexes. An index that already exists comes back 409; that is fine.
 *
 * A 403 is not fatal and must not stop the run: creating indexes needs
 * `datastore.indexes.create`, which the Firebase Admin SDK service account does
 * not hold, and the rules deploy above is the part that actually matters for
 * safety. Firestore also fails a query that needs a missing index with a
 * console link that builds it in one click, so this degrades to a note.
 */
async function deployIndexes() {
  const config = JSON.parse(readFileSync(path.join(ROOT, "firestore.indexes.json"), "utf8"));
  const missing = [];

  for (const index of config.indexes ?? []) {
    const { collectionGroup, queryScope, fields } = index;
    const result = await api(
      "POST",
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)` +
        `/collectionGroups/${collectionGroup}/indexes`,
      { queryScope, fields },
    );

    if (result.ok) ok(`index on ${collectionGroup} building`);
    else if (result.status === 409) ok(`index on ${collectionGroup} already exists`);
    else if (result.status === 403) {
      bad(`index on ${collectionGroup} — no permission with this key`);
      missing.push(index);
    } else throw new Error(`index on ${collectionGroup} failed — ${result.text.slice(0, 300)}`);
  }

  if (missing.length > 0) {
    console.log(
      `\n  ${missing.length} index(es) could not be created with a service-account key.` +
        `\n  Either run \`firebase deploy --only firestore:indexes\` signed in as` +
        `\n  yourself, or open the notifications screen once — Firestore will fail` +
        `\n  that query with a console link that builds the index in one click.` +
        `\n  Until then the bell shows an error instead of a list; nothing else` +
        `\n  is affected.`,
    );
  }
}

console.log("\nDeploying:");
try {
  await deployRules("firestore.rules", "cloud.firestore", "Firestore rules");
  await deployIndexes();
  if (storageReady) {
    await deployRules(
      "storage.rules",
      `firebase.storage%2F${projectId}.firebasestorage.app`,
      "Storage rules",
    );
  } else {
    bad("Storage rules skipped — no bucket");
  }
} catch (error) {
  console.error(`\n${error.message}\n`);
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
Done.${first && second ? `

  CREW_UIDS=${first.uid},${second.uid}` : ""}

Remaining, in order:

  1. Firebase console → Authentication → Settings → Authorised domains
     → add your Vercel domain, or sign-in fails with auth/unauthorized-domain.
  2. Vercel → Environment Variables → add the six NEXT_PUBLIC_FIREBASE_* values,
     the Maps key, and CREW_UIDS (printed above once both accounts exist)
  3. Remove NEXT_PUBLIC_DEMO_MODE from any environment you want running on real
     data, then redeploy — it is read at build time.
  4. Commit the updated firestore.rules.
`);
