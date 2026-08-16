#!/usr/bin/env node
/**
 * One-way migration from a Flyra export into this CRM.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/import-flyra.mjs --dir /path/to/export [--dry-run]
 *
 * The export directory holds customers.csv, jobs.csv, estimates.csv and
 * invoices.csv as produced by Flyra. Those files are real customer names,
 * phone numbers and addresses — keep them out of this repository, which is
 * public.
 *
 * Safe to run twice. Every document gets a deterministic id derived from its
 * Flyra id, so a second run updates the same records instead of creating a
 * parallel set. That matters because a migration is rarely one attempt.
 *
 * What it does NOT do:
 *
 *   - Geocode. Flyra exported addresses, not coordinates, so imported
 *     customers land with lat/lng 0 and no map pin. They are complete
 *     everywhere else: list, pipeline, detail, search. See the note printed
 *     at the end.
 *   - Invent an invoice model. This CRM tracks money on jobs (price, paidAt)
 *     and on the customer (lifetimeValue, pipelineValue). Invoice history is
 *     folded into those numbers and recorded in the timeline rather than
 *     modelled separately.
 *   - Silently fix the data-quality problems Flyra's own README flags. Each
 *     one is written into the affected customer's timeline so whoever opens
 *     the record sees the caveat, rather than trusting a number this script
 *     quietly adjusted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const dirFlag = args.indexOf("--dir");
const EXPORT_DIR = dirFlag !== -1 ? args[dirFlag + 1] : "./flyra-export";

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON.");
  process.exit(1);
}

const sa = JSON.parse(readFileSync(keyPath, "utf8"));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();

/**
 * Who the imported records are attributed to.
 *
 * A real uid rather than a synthetic one, so the per-user colours, the "logged
 * by" filter and the day view all behave normally. The fact that these came
 * from Flyra rather than from someone at a door is recorded on each timeline
 * instead, where it is visible and cannot be mistaken for a knock.
 */
const IMPORTER = { uid: "Bzo7rclax4SdT7PaAua1monNxXG3", displayName: "Nicolas" };

// ---------------------------------------------------------------- CSV
/**
 * RFC 4180 parser. Written out rather than pulled in as a dependency because
 * these files contain quoted commas, quoted newlines and escaped quotes — the
 * notes fields are free text — and a split(",") loses records silently, which
 * is the worst possible failure for a migration.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const read = (name) => parseCsv(readFileSync(path.join(EXPORT_DIR, name), "utf8"));

// ---------------------------------------------------------------- mapping
const num = (v) => {
  const n = Number.parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const stamp = (iso) => (iso ? Timestamp.fromDate(new Date(iso)) : null);

/**
 * Flyra had free-text job titles; this CRM has three service types because
 * that is what the business actually sells. Matched on the words that appear
 * in the real export — anything unrecognised falls back to pressure washing,
 * which is the bulk of the work.
 */
function serviceTypeFrom(...texts) {
  const t = texts.join(" ").toLowerCase();
  if (/snow|plow|salt|ice|de-?ice/.test(t)) return "snow_removal";
  if (/yard|mulch|grass|cut|till|seed|landscap|clipping|bush|trim|leaf|lawn/.test(t)) {
    return "landscaping";
  }
  return "pressure_washing";
}

const JOB_STATUS = {
  completed: "complete",
  cancelled: "cancelled",
  scheduled: "scheduled",
  in_progress: "in_progress",
};

/** Flyra drafts were never sent, so they are not "sent" quotes here. */
const QUOTE_STATUS = { sent: "sent", accepted: "accepted", declined: "declined", draft: "no_response" };

const CUSTOMER_STATUS = { Customer: "customer", "Quoted Lead": "quoted", Lead: "lead" };

/**
 * Flyra's lead_source values do not line up with this CRM's, and guessing
 * wrongly would misreport where the work comes from. Only "Direct" maps to
 * something meaningful; everything else becomes "manual" and the original
 * string is kept as a tag so nothing is lost.
 */
function sourceFrom(leadSource) {
  const s = (leadSource ?? "").trim().toLowerCase();
  if (s === "direct") return "door_knock";
  if (s === "referral") return "referral";
  return "manual";
}

let noteSeq = 0;
function note(text, kind, createdAt) {
  return {
    id: `flyra-${(noteSeq++).toString(36)}`,
    text,
    kind,
    authorUid: IMPORTER.uid,
    authorName: IMPORTER.displayName,
    createdAt: createdAt ?? Timestamp.now(),
  };
}

/**
 * Caveats from Flyra's own export README, attached to the records they concern.
 * Written onto the timeline rather than applied to the numbers: this script
 * cannot tell which invoice was the duplicate, and a silently corrected total
 * is worse than a flagged one.
 */
const DATA_QUALITY = {
  "Kim Nestor":
    "Imported from Flyra with two identical $503.50 invoices, likely a duplicate. " +
    "The outstanding balance shown ($1,134.20) counts both. The real figure is " +
    "probably $630.70 — check before chasing payment.",
  "Rob McDowell":
    "Imported from Flyra with two large invoices ($4,505.00 and $4,441.40) marked " +
    "paid within the same minute on 2026-06-10. If only one payment actually " +
    "landed, the lifetime total is overstated by about $4,441 — verify against " +
    "bank deposits.",
  "Jeff Hicks":
    "Two Jeff Hicks records came across from Flyra with different phone numbers. " +
    "Could be one person with two lines or two people — verify, then delete one.",
  "Mark Hall":
    "Two Mark Hall records came across from Flyra with different phone numbers. " +
    "Could be one person with two lines or two people — verify, then delete one.",
};

const PLACEHOLDER = /^(unknown|unkown)\s*\d*$/i;

// ---------------------------------------------------------------- load
const customers = read("customers.csv");
const jobs = read("jobs.csv");
const estimates = read("estimates.csv");
const invoices = read("invoices.csv");

console.log(
  `\nRead ${customers.length} customers, ${jobs.length} jobs, ` +
    `${estimates.length} estimates, ${invoices.length} invoices` +
    `${DRY_RUN ? "  (dry run)" : ""}\n`,
);

// Flyra ids are uuids; a stable prefix keeps document ids readable in the
// console and makes an imported record obvious at a glance.
const docId = (flyraId) => `fl-${String(flyraId).slice(0, 8)}`;

const byFlyraId = new Map(customers.map((c) => [c.flyra_customer_id, c]));

/**
 * Some estimates carry no customer id, and the invoice export has no id column
 * at all — Flyra's invoice API does not expose one. Both fall back to the
 * display name, which is unique in this export.
 */
const byName = new Map(customers.map((c) => [c.display_name, c]));
const resolveCustomer = (flyraId, name) =>
  byFlyraId.get(flyraId) ?? byName.get(name) ?? null;

/** Estimates and jobs grouped by customer, for stage and value derivation. */
const estimatesFor = new Map();
for (const e of estimates) {
  const owner = resolveCustomer(e.flyra_customer_id, e.customer_name);
  if (!owner) continue;
  const list = estimatesFor.get(owner.flyra_customer_id) ?? [];
  list.push(e);
  estimatesFor.set(owner.flyra_customer_id, list);
}
const jobsFor = new Map();
for (const j of jobs) {
  const list = jobsFor.get(j.flyra_customer_id) ?? [];
  list.push(j);
  jobsFor.set(j.flyra_customer_id, list);
}

// ---------------------------------------------------------------- customers
/**
 * Where a record lands on the board. Order matters: money owed outranks money
 * received, because an unpaid balance is the thing that needs chasing.
 */
function pipelineStageFor(row, custEstimates, custJobs) {
  const outstanding = num(row.outstanding_balance_usd);
  const paid = num(row.lifetime_paid_usd);

  if (outstanding > 0) return "awaiting_payment";
  if (paid > 0) return "paid";
  if (custJobs.some((j) => j.status === "scheduled")) return "job_scheduled";
  if (custEstimates.some((e) => e.status === "accepted")) return "estimate_accepted";
  if (custEstimates.length > 0) return "estimate_sent";
  return "new_lead";
}

function addressFrom(row) {
  // Some rows already carry a full "street, city ST zip" string in `address`
  // and leave the split columns empty; others populate the split columns.
  const parts = [row.address, row.unit].filter(Boolean).join(" ");
  const tail = [row.city, [row.state, row.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const full = [parts, tail].filter(Boolean).join(", ").trim();
  return full === "N/A" || full === "" ? "" : full;
}

const customerDocs = [];

for (const row of customers) {
  const flyraId = row.flyra_customer_id;
  const custEstimates = estimatesFor.get(flyraId) ?? [];
  const custJobs = jobsFor.get(flyraId) ?? [];

  const notes = [];
  if (row.notes) notes.push(note(row.notes, "note", stamp(row.created_at)));

  const latestEstimate = [...custEstimates].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)),
  ).at(-1);

  const summary = [
    `Imported from Flyra on ${new Date().toISOString().slice(0, 10)}.`,
    `Flyra id ${flyraId}.`,
    `${row.jobs_count || 0} job(s), ${row.estimates_count || 0} estimate(s), ${row.invoices_count || 0} invoice(s).`,
    num(row.lifetime_paid_usd) > 0 ? `Lifetime paid $${row.lifetime_paid_usd}.` : null,
    num(row.outstanding_balance_usd) > 0 ? `Outstanding $${row.outstanding_balance_usd}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  notes.push(note(summary, "lead_import", stamp(row.created_at)));

  const unpaid = invoices.filter(
    (inv) => inv.customer_name === row.display_name && num(inv.balance_usd) > 0,
  );
  if (unpaid.length > 0) {
    notes.push(
      note(
        `Unpaid at migration: ${unpaid
          .map((inv) => `$${inv.balance_usd} (${inv.status})`)
          .join(", ")}. Total $${unpaid.reduce((s, inv) => s + num(inv.balance_usd), 0).toFixed(2)}.`,
        "note",
        Timestamp.now(),
      ),
    );
  }

  const caveat = DATA_QUALITY[row.display_name];
  if (caveat) notes.push(note(caveat, "note", Timestamp.now()));

  const isPlaceholder =
    PLACEHOLDER.test(row.display_name ?? "") || PLACEHOLDER.test(row.first_name ?? "");
  if (isPlaceholder) {
    notes.push(
      note(
        "Placeholder name from Flyra — the phone number is real but the name is not. " +
          "Identify from your call history and rename.",
        "note",
        Timestamp.now(),
      ),
    );
  }

  const serviceType = serviceTypeFrom(
    ...custJobs.map((j) => `${j.title} ${j.notes}`),
    ...custEstimates.map((e) => e.subject ?? ""),
    row.notes ?? "",
  );

  const tags = [];
  if (row.lead_source) tags.push(`flyra:${row.lead_source}`);
  if (isPlaceholder) tags.push("needs-name");
  if (num(row.outstanding_balance_usd) > 0) tags.push("owes-money");

  const outstanding = num(row.outstanding_balance_usd);

  customerDocs.push({
    id: docId(flyraId),
    data: {
      firstName: row.first_name || row.display_name || "",
      lastName: row.last_name || "",
      phone: row.phone || "",
      email: row.email || "",
      address: addressFrom(row),
      // No coordinates in the export. 0/0 means "no pin" everywhere in the app.
      lat: 0,
      lng: 0,
      status: CUSTOMER_STATUS[row.customer_type] ?? "lead",
      notes,
      tags,
      // Only claim a service type when there is evidence; a bare lead has none.
      serviceTypes: custJobs.length > 0 || custEstimates.length > 0 ? [serviceType] : [],
      createdAt: stamp(row.created_at) ?? Timestamp.now(),
      createdBy: IMPORTER.uid,
      createdByName: IMPORTER.displayName,
      lastContactedAt: stamp(row.last_job_date) ?? stamp(row.updated_at),
      lastContactedBy: IMPORTER.uid,
      lastContactedByName: IMPORTER.displayName,
      lifetimeValue: num(row.lifetime_paid_usd),
      pipelineStage: pipelineStageFor(row, custEstimates, custJobs),
      pipelineChangedAt: stamp(row.updated_at) ?? Timestamp.now(),
      pipelineValue: outstanding > 0 ? outstanding : num(latestEstimate?.total_usd),
      source: sourceFrom(row.lead_source),
      sourceLeadId: `flyra:${flyraId}`,
      updatedAt: Timestamp.now(),
      updatedBy: IMPORTER.uid,
      updatedByName: IMPORTER.displayName,
    },
  });
}

// ---------------------------------------------------------------- jobs
const jobDocs = [];

for (const row of jobs) {
  const customer = byFlyraId.get(row.flyra_customer_id);
  if (!customer) {
    console.log(`  skipped job ${row.flyra_job_id} — no matching customer`);
    continue;
  }

  const start = stamp(row.scheduled_start) ?? stamp(row.scheduled_date) ?? stamp(row.created_at);
  const end = stamp(row.scheduled_end) ?? start;
  const completedAt = stamp(row.completed_at);

  jobDocs.push({
    id: docId(row.flyra_job_id),
    data: {
      customerId: docId(row.flyra_customer_id),
      serviceType: serviceTypeFrom(row.title, row.service, row.notes, row.description),
      scheduledStart: start ?? Timestamp.now(),
      scheduledEnd: end ?? Timestamp.now(),
      status: JOB_STATUS[row.status] ?? "scheduled",
      price: num(row.amount_usd),
      assignedTo: [IMPORTER.uid],
      beforePhotos: [],
      afterPhotos: [],
      jobNotes: [row.title, row.notes, row.description].filter(Boolean).join(" — "),
      completedAt,
      completedBy: completedAt ? IMPORTER.uid : null,
      // Flyra tracked payment on the job as well as the invoice; this is the
      // field the awaiting-payment stage reads.
      paidAt: row.payment_status === "paid" ? (completedAt ?? Timestamp.now()) : null,
      paidBy: row.payment_status === "paid" ? IMPORTER.uid : null,
      createdAt: stamp(row.created_at) ?? Timestamp.now(),
      createdBy: IMPORTER.uid,
      createdByName: IMPORTER.displayName,
      updatedAt: Timestamp.now(),
      updatedBy: IMPORTER.uid,
      updatedByName: IMPORTER.displayName,
    },
  });
}

// ---------------------------------------------------------------- quotes
const quoteDocs = [];

for (const row of estimates) {
  // An estimate that belongs to nobody would put money on the board with no
  // record to chase it against.
  const owner = resolveCustomer(row.flyra_customer_id, row.customer_name);
  if (!owner) {
    console.log(
      `  skipped estimate ${row.flyra_estimate_id} (${row.customer_name || "no name"}) — no customer link`,
    );
    continue;
  }

  quoteDocs.push({
    id: docId(row.flyra_estimate_id),
    data: {
      customerId: docId(owner.flyra_customer_id),
      serviceType: serviceTypeFrom(row.subject ?? ""),
      amount: num(row.total_usd),
      sentAt: stamp(row.sent_at) ?? stamp(row.created_at) ?? Timestamp.now(),
      sentBy: IMPORTER.uid,
      sentByName: IMPORTER.displayName,
      status: QUOTE_STATUS[row.status] ?? "sent",
      followUpCount: 0,
      lastFollowUpAt: null,
    },
  });
}

// ---------------------------------------------------------------- report
const stageCounts = {};
for (const c of customerDocs) {
  stageCounts[c.data.pipelineStage] = (stageCounts[c.data.pipelineStage] ?? 0) + 1;
}

console.log("Pipeline stages:");
for (const [stage, n] of Object.entries(stageCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${stage.padEnd(20)} ${n}`);
}

const withAddress = customerDocs.filter((c) => c.data.address).length;
console.log(`\nCustomers: ${customerDocs.length}  (${withAddress} with an address)`);
console.log(`Jobs:      ${jobDocs.length}`);
console.log(`Quotes:    ${quoteDocs.length}`);
console.log(
  `Lifetime value total: $${customerDocs.reduce((s, c) => s + c.data.lifetimeValue, 0).toFixed(2)}`,
);
console.log(
  `Outstanding total:    $${customerDocs
    .filter((c) => c.data.pipelineStage === "awaiting_payment")
    .reduce((s, c) => s + c.data.pipelineValue, 0)
    .toFixed(2)}`,
);

if (DRY_RUN) {
  console.log("\nSample customer:");
  console.log(JSON.stringify(customerDocs[0], null, 2).slice(0, 1200));
  console.log("\nDry run — nothing written.\n");
  process.exit(0);
}

// ---------------------------------------------------------------- write
async function writeAll(collection, docs) {
  // Firestore caps a batch at 500 writes; these collections are far smaller,
  // but chunking costs nothing and stops this breaking on a bigger export.
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + 400)) {
      batch.set(db.collection(collection).doc(doc.id), doc.data, { merge: true });
    }
    await batch.commit();
  }
  console.log(`  wrote ${docs.length} → ${collection}`);
}

console.log("\nWriting:");
await writeAll("customers", customerDocs);
await writeAll("jobs", jobDocs);
await writeAll("quotes", quoteDocs);

console.log(`
Done.

Imported customers have no map pin: Flyra exported addresses, not
coordinates. They are complete everywhere else — list, search, pipeline,
detail, scheduling. Run the geocode backfill from the Account screen to
place them on the map.

Re-running this script is safe. Document ids are derived from Flyra ids, so
a second run updates the same records rather than duplicating them.
`);
