/**
 * Write phoneE164 on every customer record that does not have it, once.
 *
 *   node --experimental-strip-types scripts/backfill-phone-e164.mjs         # report
 *   node --experimental-strip-types scripts/backfill-phone-e164.mjs --write # apply
 *
 * The flag is there because this imports phoneKey from lib/portalMatch.ts
 * directly rather than copying it. A backfilled number that normalises even
 * slightly differently from the sign-in lookup is a customer who signs in and
 * sees nothing, so the two must be the same function, not the same intention.
 *
 * The account portal matches a signed-in customer by the number Firebase
 * verified, which arrives as strict E.164 ("+15025550100"). The `phone` field
 * holds whatever was typed on a porch — "(502) 555-0100", "502-555-0100" — so
 * there is nothing for that lookup to query against until this has run. New
 * records carry the field from creation; this brings the existing ones in line.
 *
 * Needs FIREBASE_SERVICE_ACCOUNT_KEY (base64 JSON), the same variable the API
 * routes use. Idempotent — running it twice changes nothing the second time.
 *
 * A number that cannot be normalised is written as "" rather than skipped. The
 * distinction matters: skipping leaves the field absent, and an equality query
 * on an absent field matches nothing, which is the same outcome but leaves no
 * record that the row was looked at. An explicit empty string says "considered,
 * not usable" — and an empty stored value can never match a verified identity,
 * because lib/portalMatch.ts refuses empty on both sides.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { phoneKey } from "../lib/portalMatch.ts";

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
let unusable = 0;
let batch = db.batch();
let inBatch = 0;

for (const doc of snap.docs) {
  const existing = doc.get("phoneE164");
  // phoneKey returns null for anything it will not vouch for; stored as "".
  const key = phoneKey(doc.get("phone")) ?? "";
  // Already correct — including the case where both are "" — so leave it be.
  // This is what makes a second run a no-op.
  if (typeof existing === "string" && existing === key) continue;

  changed += 1;
  if (!key) unusable += 1;
  console.log(`${doc.id}: "${doc.get("phone") ?? ""}" -> "${key}"${key ? "" : "  (not a usable number)"}`);

  if (write) {
    batch.update(doc.ref, { phoneE164: key });
    inBatch += 1;
    if (inBatch === 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
}
if (write && inBatch > 0) await batch.commit();

console.log(
  `${snap.size} customers, ${changed} ${write ? "updated" : "would change (pass --write to apply)"}` +
    (unusable ? `, ${unusable} with no usable number (stored as "")` : ""),
);
