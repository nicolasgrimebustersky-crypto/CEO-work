/**
 * Creates a DRAFT estimate in GrimelineCRM, authenticated as a crew member.
 *
 * Marcus drafts the line-item wording; this puts it in the CRM as a draft
 * document so Nicolas can open it, check it, and send it from the app. It
 * cannot send anything. `status` is hardcoded to "draft" and there is no flag
 * to change that — hard rules 3 and 4 stand.
 *
 * Why sign in as a crew user rather than use a service account: Firestore
 * security rules do not apply to service accounts. A service-account key with
 * write access would bypass every clause in firestore.rules and could write
 * anything anywhere, including the `users` collection that decides who counts
 * as crew. Signing in as a real crew account means the rules apply to this
 * script exactly as they apply to the app, and every document it creates
 * carries a genuine author stamp.
 *
 * The money math and the numbering are imported from the CRM's own
 * `lib/documents.ts` rather than reimplemented here. A second copy of the tax
 * arithmetic would drift from the app's the first time either changed, and the
 * two would disagree about what a customer owes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/create-estimate.ts \
 *     --customer-id abc123 \
 *     --service pressure_washing \
 *     --line-items '[{"name":"Driveway pressure wash","description":"Front drive and walk","quantity":1,"unitPrice":315}]' \
 *     [--notes "..."] [--discount 0] [--tax-rate 6] [--dry-run]
 *
 * Requires in grimebusters-ops/.env:
 *   CREW_EMAIL, CREW_PASSWORD          the Marcus crew account
 *   NEXT_PUBLIC_FIREBASE_API_KEY       from the CRM's own web config
 *   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
} from "firebase/firestore";

import {
  computeTotals,
  DEFAULT_TAX_RATE_PCT,
  nextNumber,
} from "../../lib/documents.ts";

const OPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE_TYPES = ["pressure_washing", "landscaping", "snow_removal"];

function die(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

/**
 * Reads .env without adding a dependency. Values may be single- or
 * double-quoted — a password containing & or $ must be quoted or bash's
 * `source .env` in the shell scripts mangles it, so this reader strips a
 * matching pair of surrounding quotes to agree with what bash sees.
 */
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(join(OPS_DIR, ".env"), "utf8");
  } catch {
    die(`no .env at ${join(OPS_DIR, ".env")}`);
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"')))
    ) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const env = loadEnv();
const dryRun = process.argv.includes("--dry-run");

for (const key of [
  "CREW_EMAIL",
  "CREW_PASSWORD",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
]) {
  if (!env[key]) die(`${key} is not set in grimebusters-ops/.env`);
}

const customerId = arg("customer-id");
const serviceType = arg("service");
const lineItemsRaw = arg("line-items");

if (!customerId) die("--customer-id is required");
if (!serviceType || !SERVICE_TYPES.includes(serviceType)) {
  die(`--service must be one of ${SERVICE_TYPES.join(", ")}`);
}
if (!lineItemsRaw) die("--line-items is required (a JSON array)");

let parsed: unknown;
try {
  parsed = JSON.parse(lineItemsRaw);
} catch (error) {
  die(`--line-items is not valid JSON: ${(error as Error).message}`);
}
if (!Array.isArray(parsed) || parsed.length === 0) {
  die("--line-items must be a non-empty JSON array");
}

/**
 * Every line needs a price. A missing `unitPrice` would silently become a $0
 * line and quietly understate the estimate, which is the kind of error that
 * only surfaces in front of a customer.
 */
const lineItems = parsed.map((entry, index) => {
  const item = entry as Record<string, unknown>;
  if (typeof item.name !== "string" || !item.name.trim()) {
    die(`line item ${index + 1} has no name`);
  }
  if (typeof item.unitPrice !== "number" || !Number.isFinite(item.unitPrice)) {
    die(`line item ${index + 1} ("${item.name}") has no numeric unitPrice`);
  }
  return {
    id: String(index + 1),
    name: item.name.trim(),
    description: typeof item.description === "string" ? item.description : "",
    quantity: typeof item.quantity === "number" ? item.quantity : 1,
    unitPrice: item.unitPrice,
    taxable: item.taxable === undefined ? true : Boolean(item.taxable),
    discountPct: typeof item.discountPct === "number" ? item.discountPct : 0,
  };
});

const discount = Number(arg("discount") ?? 0);
const taxRatePct = Number(arg("tax-rate") ?? DEFAULT_TAX_RATE_PCT);
if (!Number.isFinite(discount) || discount < 0) die("--discount must be >= 0");
if (!Number.isFinite(taxRatePct) || taxRatePct < 0) die("--tax-rate must be >= 0");

const app = initializeApp({
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);

const credential = await signInWithEmailAndPassword(
  getAuth(app),
  env.CREW_EMAIL,
  env.CREW_PASSWORD,
).catch((error: Error) => {
  die(`could not sign in as ${env.CREW_EMAIL}: ${error.message}`);
});

const author = {
  uid: credential.user.uid,
  displayName: credential.user.displayName ?? "Marcus",
};

const customerSnap = await getDoc(doc(db, "customers", customerId)).catch(
  (error: Error) => die(`could not read customer ${customerId}: ${error.message}`),
);
if (!customerSnap.exists()) die(`no customer with id ${customerId}`);
const customer = customerSnap.data() as Record<string, unknown>;
const customerName = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim();

// Same approach as the app: read the existing numbers and take the next one.
// A stored counter would drift the first time a write failed halfway.
const existing = await getDocs(collection(db, "documents")).catch((error: Error) =>
  die(`could not read existing documents to allocate a number: ${error.message}`),
);
const number = nextNumber(existing.docs.map((d) => String(d.data().number ?? "")));

const totals = computeTotals(lineItems, discount, taxRatePct);

const payload = {
  number,
  kind: "estimate",
  status: "draft",
  customerId,
  customerName,
  serviceType,
  lineItems,
  discount: totals.discount,
  taxRatePct,
  subtotal: totals.subtotal,
  taxAmount: totals.taxAmount,
  total: totals.total,
  payments: [],
  amountPaid: 0,
  balanceDue: totals.total,
  notes: arg("notes") ?? "",
  issuedAt: serverTimestamp(),
  dueAt: null,
  sentAt: null,
  settledAt: null,
  convertedFromId: null,
  convertedToId: null,
  scheduledJobId: null,
  createdAt: serverTimestamp(),
  createdBy: author.uid,
  createdByName: author.displayName,
  updatedAt: serverTimestamp(),
  updatedBy: author.uid,
  updatedByName: author.displayName,
};

if (dryRun) {
  console.log("DRY RUN — nothing written. Payload would be:");
  console.log(
    JSON.stringify(
      { ...payload, issuedAt: "<serverTimestamp>", createdAt: "<serverTimestamp>", updatedAt: "<serverTimestamp>" },
      null,
      2,
    ),
  );
  console.log(`\nEstimate #${number} for ${customerName} — total $${totals.total}`);
  process.exit(0);
}

const ref = await addDoc(collection(db, "documents"), payload).catch((error: Error) =>
  die(`write rejected: ${error.message}`),
);

// Read it back before claiming it exists. A write that reported success and a
// document that is actually there are two different facts.
const check = await getDoc(ref).catch((error: Error) =>
  die(`created ${ref.id} but could not read it back: ${error.message}`),
);
if (!check.exists()) die(`addDoc returned ${ref.id} but no document is there`);

console.log(`Created draft estimate #${number} (${ref.id}) for ${customerName}`);
console.log(`Total $${totals.total} — status draft, not sent.`);
console.log("Open it in the CRM to review and send.");
process.exit(0);
