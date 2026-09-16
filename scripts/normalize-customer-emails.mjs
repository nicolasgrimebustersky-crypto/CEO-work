/**
 * Lowercase and trim the email on every customer record, once.
 *
 *   node scripts/normalize-customer-emails.mjs            # report only
 *   node scripts/normalize-customer-emails.mjs --write    # apply
 *
 * The account portal matches a signed-in customer to their records by exact
 * email, and Firestore compares strings case-sensitively. New records are
 * stored lowercase from now on; this brings the existing ones in line. Needs
 * FIREBASE_SERVICE_ACCOUNT_KEY (base64 JSON), the same variable the API
 * routes use. Idempotent — running it twice changes nothing the second time.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

const snap = await db.collection("customers").get();
let changed = 0;
let batch = db.batch();
let inBatch = 0;
for (const doc of snap.docs) {
  const email = doc.get("email");
  if (typeof email !== "string") continue;
  const clean = email.trim().toLowerCase();
  if (clean === email) continue;
  changed += 1;
  console.log(`${doc.id}: "${email}" -> "${clean}"`);
  if (write) {
    batch.update(doc.ref, { email: clean });
    inBatch += 1;
    if (inBatch === 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
}
if (write && inBatch > 0) await batch.commit();
console.log(`${snap.size} customers, ${changed} ${write ? "updated" : "would change (pass --write to apply)"}`);
