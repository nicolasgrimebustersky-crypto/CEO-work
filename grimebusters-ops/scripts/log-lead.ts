/**
 * Logs prospecting leads into GrimelineCRM, authenticated as a crew member.
 *
 * Leads are `customers` documents with `status: "lead"` and
 * `pipelineStage: "new_lead"` — the same shape the app's own
 * `lib/db/customers.ts#createCustomer` writes, so a lead logged here renders
 * identically to one added by hand in the app.
 *
 * Added 2026-08-25 on Nicolas's direct instruction ("log it in the CRM"),
 * as the second sanctioned write path alongside create-estimate.ts. Same
 * safety shape as that script: it signs in as a crew user, never a service
 * account, so firestore.rules apply to every write exactly as they apply to
 * the app — including validCustomer() and the author stamp. It cannot touch
 * estimates, jobs, or anything but customer-lead creation.
 *
 * Duplicate guard: an incoming lead whose name matches an existing customer
 * (case-insensitive, on the stored `firstName`/`lastName`) is skipped, so
 * re-running a batch cannot double-log the pipeline.
 *
 * Usage:
 *   node --experimental-strip-types scripts/log-lead.ts \
 *     --file leads.json [--dry-run]
 *
 * leads.json is an array of:
 *   {
 *     "name": "Business or person name",   // required; stored in firstName
 *     "phone": "", "email": "", "address": "",
 *     "lat": 38.3, "lng": -85.57,          // required numbers (rules)
 *     "note": "how this lead was sourced / outreach status",
 *     "tags": ["commercial"],
 *     "serviceTypes": ["pressure_washing"],
 *     "contacted": false                   // true ONLY if someone has actually
 *                                          // spoken to or emailed them
 *   }
 *
 * `contacted` defaults to false, which stores `lastContactedAt: null` — the
 * value this CRM uses to mean "never worked". Set it true only for a lead a
 * real message has already gone out to; see the note at the write below.
 *
 * Standing contact rule applies upstream: `email` may only be a value
 * verified against the organization's own site or an official page. This
 * script trusts its input file — the verification happens before the file
 * is written, and the note should say where each value came from.
 *
 * Requires in grimebusters-ops/.env: CREW_EMAIL, CREW_PASSWORD,
 * NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
 * NEXT_PUBLIC_FIREBASE_PROJECT_ID (same as create-estimate.ts).
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  addDoc,
  collection,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

const OPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE_TYPES = ["pressure_washing", "landscaping", "snow_removal"];

function die(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

// Same .env reader as create-estimate.ts, same single-quote rule.
const SHELL_EXPANDS = /\$(\{|[A-Za-z_])/;

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
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const singleQuoted =
      value.length >= 2 && value.startsWith("'") && value.endsWith("'");
    const doubleQuoted =
      value.length >= 2 && value.startsWith('"') && value.endsWith('"');
    if (singleQuoted || doubleQuoted) value = value.slice(1, -1);
    if (doubleQuoted && SHELL_EXPANDS.test(value)) {
      die(
        `${key} in .env is double-quoted and contains a $ that bash would expand. ` +
          `Use single quotes: ${key}='...'`,
      );
    }
    out[key] = value;
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

const filePath = arg("file");
if (!filePath) die("--file is required (a JSON array of leads)");

let parsed: unknown;
try {
  parsed = JSON.parse(
    readFileSync(isAbsolute(filePath) ? filePath : join(process.cwd(), filePath), "utf8"),
  );
} catch (error) {
  die(`could not read/parse ${filePath}: ${(error as Error).message}`);
}
if (!Array.isArray(parsed) || parsed.length === 0) {
  die("--file must contain a non-empty JSON array");
}

interface LeadInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  lat: number;
  lng: number;
  note: string;
  tags: string[];
  serviceTypes: string[];
  contacted: boolean;
}

const leads: LeadInput[] = parsed.map((entry, index) => {
  const lead = entry as Record<string, unknown>;
  if (typeof lead.name !== "string" || !lead.name.trim()) {
    die(`lead ${index + 1} has no name`);
  }
  if (typeof lead.lat !== "number" || typeof lead.lng !== "number") {
    die(`lead ${index + 1} ("${lead.name}") needs numeric lat and lng — firestore.rules requires them`);
  }
  const serviceTypes = Array.isArray(lead.serviceTypes)
    ? lead.serviceTypes.filter((s): s is string => SERVICE_TYPES.includes(s as string))
    : ["pressure_washing"];
  return {
    name: lead.name.trim(),
    phone: typeof lead.phone === "string" ? lead.phone.trim() : "",
    email: typeof lead.email === "string" ? lead.email.trim() : "",
    address: typeof lead.address === "string" ? lead.address.trim() : "",
    lat: lead.lat,
    lng: lead.lng,
    note: typeof lead.note === "string" ? lead.note.trim() : "",
    tags: Array.isArray(lead.tags)
      ? lead.tags.filter((t): t is string => typeof t === "string")
      : [],
    serviceTypes: serviceTypes.length > 0 ? serviceTypes : ["pressure_washing"],
    contacted: lead.contacted === true,
  };
});

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

// Duplicate guard: names already in the book, compared case-insensitively.
const existing = await getDocs(collection(db, "customers")).catch((error: Error) =>
  die(`could not read existing customers for the duplicate check: ${error.message}`),
);
const existingNames = new Set(
  existing.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim().toLowerCase();
  }),
);

let created = 0;
let skipped = 0;

for (const lead of leads) {
  if (existingNames.has(lead.name.toLowerCase())) {
    console.log(`SKIP (already in CRM): ${lead.name}`);
    skipped += 1;
    continue;
  }

  // Mirrors lib/db/customers.ts#createCustomer exactly, minus the UI.
  const notes = lead.note
    ? [
        {
          id: randomUUID(),
          text: lead.note,
          kind: "note",
          authorUid: author.uid,
          authorName: author.displayName,
          // serverTimestamp() is not allowed inside an array element; the
          // client clock stamps notes, same as the app.
          createdAt: Timestamp.now(),
        },
      ]
    : [];

  const payload = {
    firstName: lead.name,
    lastName: "",
    phone: lead.phone,
    email: lead.email,
    address: lead.address,
    lat: lead.lat,
    lng: lead.lng,
    status: "lead",
    notes,
    tags: lead.tags,
    serviceTypes: lead.serviceTypes,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    // null means never contacted, and this CRM means it literally.
    // `lib/filters.ts` matches "never contacted" on null alone, and treats a
    // set value as proof the record has been worked; `lib/knock/territory.ts`
    // counts a null as unknocked and calls coverage "a genuine record of
    // houses spoken to, not a checkbox somebody remembered to tick".
    //
    // The app's own createCustomer() stamps serverTimestamp() because it is
    // called from the door-knock quick-entry sheet, where the conversation
    // just happened. Prospecting is the opposite case: a business found on a
    // map has not been contacted by anyone. The Meta lead-ad ingest
    // (app/api/meta/leads/route.ts) writes null for exactly that reason, and
    // this follows it. Stamping "contacted just now" on a prospect nobody has
    // called would hide it from the one filter meant to surface it.
    ...(lead.contacted
      ? {
          lastContactedAt: serverTimestamp(),
          lastContactedBy: author.uid,
          lastContactedByName: author.displayName,
        }
      : { lastContactedAt: null, lastContactedBy: null, lastContactedByName: null }),
    lifetimeValue: 0,
    pipelineStage: "new_lead",
    pipelineChangedAt: serverTimestamp(),
    pipelineValue: 0,
    source: "manual",
    sourceLeadId: null,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  if (dryRun) {
    console.log(
      `DRY RUN — would create lead: ${lead.name} (${lead.address || "no address"})` +
        ` — ${lead.contacted ? "marked contacted" : "never contacted"}`,
    );
    created += 1;
    continue;
  }

  const ref = await addDoc(collection(db, "customers"), payload).catch(
    (error: Error) => die(`write rejected for "${lead.name}": ${error.message}`),
  );

  // Read it back before claiming it exists.
  const check = await getDoc(ref).catch((error: Error) =>
    die(`created ${ref.id} but could not read it back: ${error.message}`),
  );
  if (!check.exists()) die(`addDoc returned ${ref.id} but no document is there`);

  console.log(`Created lead: ${lead.name} (${ref.id})`);
  existingNames.add(lead.name.toLowerCase());
  created += 1;
}

console.log(
  `\n${dryRun ? "DRY RUN — " : ""}${created} lead(s) ${dryRun ? "would be " : ""}created, ${skipped} skipped as already present.`,
);
process.exit(0);
