/**
 * Stamp orgId on every document written before the field existed.
 *
 *   node scripts/backfill-org-id.mjs            # report only
 *   node scripts/backfill-org-id.mjs --write    # apply
 *
 * Not urgent, and not risky to put off: firestore.rules and every read in
 * lib/db/*.ts already treat a missing orgId as DEFAULT_ORG_ID (lib/org.ts),
 * so the app works identically before and after this runs. What it buys is
 * the next real step — filtering the app's own list queries by
 * where('orgId', '==', ...), which Firestore can only enforce correctly
 * against a query that actually has an orgId to match. A query filtered that
 * way, run before this backfill, would make every document that still lacks
 * the field disappear from every screen. Run this first. See
 * tests/orgIsolation.rules.test.mjs for exactly what that gap is and why
 * get()-by-id is already safe without it.
 *
 * Needs FIREBASE_SERVICE_ACCOUNT_KEY (base64 JSON), the same variable the API
 * routes use. Idempotent — a document that already has an orgId is left
 * alone, so running this twice, or after new documents have already started
 * carrying the field, changes nothing extra.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const DEFAULT_ORG_ID = "grime-busters"; // lib/org.ts

// Every collection lib/types.ts gives an orgId. Notably absent: otpCodes,
// auditLog and apiKeys, which are admin-only and were never per-org to begin
// with, and the messages/reads subcollections under conversations, which
// inherit their parent conversation's org rather than carrying their own.
const COLLECTIONS = [
  "users",
  "customers",
  "jobs",
  "quotes",
  "documents",
  "services",
  "notifications",
  "pushTokens",
  "knockRoutes",
  "territories",
  "conversations",
];

const write = process.argv.includes("--write");
const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!raw) {
  console.error("FIREBASE_SERVICE_ACCOUNT_KEY is not set.");
  process.exit(1);
}
if (getApps().length === 0) {
  initializeApp({ credential: cert(JSON.parse(Buffer.from(raw, "base64").toString("utf8"))) });
}
const db = getFirestore();

let totalSeen = 0;
let totalChanged = 0;

for (const name of COLLECTIONS) {
  const snap = await db.collection(name).get();
  let changed = 0;
  let batch = db.batch();
  let inBatch = 0;

  for (const doc of snap.docs) {
    totalSeen += 1;
    if (typeof doc.get("orgId") === "string" && doc.get("orgId").trim()) continue;

    changed += 1;
    if (write) {
      batch.update(doc.ref, { orgId: DEFAULT_ORG_ID });
      inBatch += 1;
      if (inBatch === 400) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
  }
  if (write && inBatch > 0) await batch.commit();

  totalChanged += changed;
  console.log(
    `${name}: ${snap.size} documents, ${changed} ${write ? "stamped" : "would be stamped"}`,
  );
}

console.log(
  `\n${totalSeen} documents across ${COLLECTIONS.length} collections, ` +
    `${totalChanged} ${write ? "stamped with orgId" : "would be stamped (pass --write to apply)"}.`,
);
