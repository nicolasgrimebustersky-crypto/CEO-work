#!/usr/bin/env node
/**
 * Folds a legacy invoice export into the customer book.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/import-legacy-invoices.mjs --file /path/to/invoices.csv [--dry-run]
 *
 * This is the Invoice Fly history, September 2025 to July 2026. The business
 * ran Invoice Fly for everything through a stretch when Flyra was not in use,
 * and both were live around the changeover — so this file predates the Flyra
 * export, overlaps it, and is the authoritative record for the window in
 * between.
 *
 * It carries the outstanding money. Flyra reported $1,399.20 owed; this file
 * has roughly ten times that, almost all commercial. Those debts were
 * invisible in the CRM until now.
 *
 * The file itself is real customer names, emails and money — keep it out of
 * this repository, which is public.
 *
 * Three problems this has to solve, none of which a straight append handles:
 *
 *   Overlap. A handful of invoices appear in both exports (Sandy Watts
 *   $651.90, Becky Woo $318.00 — same amounts, days apart). Adding them again
 *   would silently double those customers' lifetime value.
 *
 *   Identity. The two systems spell people differently: Carry Hearn / Carry
 *   Hern, Julie Wagner / Jullie Wagner, Steve Stacey / Steve Stacy. And
 *   "Ware" invoices carry Kim Nestor's email address. Revenue attached to the
 *   wrong record is worse than revenue attached to none.
 *
 *   Stage. Customers sitting as untouched leads turn out to owe money —
 *   Cattleman's and Burger King among them. They belong in awaiting_payment,
 *   which is the column that gets chased.
 */
import { readFileSync } from "node:fs";

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const fileFlag = args.indexOf("--file");
const FILE = fileFlag !== -1 ? args[fileFlag + 1] : null;

if (!FILE) {
  console.error("Pass --file /path/to/invoices.csv");
  process.exit(1);
}
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON.");
  process.exit(1);
}

const sa = JSON.parse(readFileSync(keyPath, "utf8"));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();

const IMPORTER = { uid: "Bzo7rclax4SdT7PaAua1monNxXG3", displayName: "Nicolas" };

/**
 * Marks a record this script has already touched. Unlike the Flyra import,
 * this one *adds* to existing lifetime values, so a second run would silently
 * double them. It refuses instead.
 */
const LEGACY_MARKER = "Legacy invoice history imported";
const FORCE = process.argv.includes("--force");

// ---------------------------------------------------------------- CSV
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

const num = (v) => {
  const n = Number.parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** The export writes US dates (7/18/2026), not ISO. */
function usDate(value) {
  if (!value) return null;
  const [m, d, y] = value.split("/").map(Number);
  if (!m || !d || !y) return null;
  return Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d, 12)));
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9]/g, "");

/**
 * Spelling variants confirmed with the owner. Left explicit rather than
 * computed with an edit-distance threshold: a fuzzy matcher that silently
 * decides two people are one is exactly the failure worth avoiding here, and
 * the list is short enough to be read and checked.
 */
const ALIASES = new Map(
  Object.entries({
    ware: "Kim Nestor",
    carryhearn: "Carry Hern",
    juliewagner: "Jullie Wagner",
    stevestacey: "Steve Stacy",
    cattlemanslagrange: "Cattlemans La Grange",
    burgerkinglagrange: "Burger King La grange",
    stevemattingly: "Steve Mattingly",
  }).map(([k, v]) => [k, norm(v)]),
);

/**
 * Not merged. "Christine's Mom" is a different household from Christine
 * Mccloy, and "Jackie Boon" is only a plausible match for Jacqui Bone — not
 * a certain one. Both are created as their own records and flagged, so a
 * human decides rather than this script.
 */
const FLAG_FOR_REVIEW = new Set([norm("Christine's Mom"), norm("Jackie Boon")]);

/**
 * Same-client, same-amount invoices issued the same day. The pattern that
 * turned out to be a duplicate on Kim Nestor's Flyra record, so it is worth
 * surfacing rather than trusting — but not worth halving a total over, since
 * two houses at one price is equally possible.
 */
const DUPLICATE_SUSPECTS = {
  [norm("Carry Hearn")]:
    "Two $795.00 invoices (8895 and 8897) were both issued 4/8/2026 and both marked " +
    "paid, on 4/18 and 4/21. If that is one job billed twice, the lifetime value here " +
    "is double the real figure — check against deposits before treating $1,590 as earned.",
};
const REVIEW_HINT = {
  [norm("Christine's Mom")]:
    "Legacy invoice named \"Christine's Mom\" — possibly related to Christine Mccloy. " +
    "Created separately rather than guessed; merge if they are the same household.",
  [norm("Jackie Boon")]:
    'Legacy invoice named "Jackie Boon" — possibly the same person as Jacqui Bone. ' +
    "Created separately rather than guessed; merge if so.",
};

// ---------------------------------------------------------------- load
const invoices = parseCsv(readFileSync(FILE, "utf8"));
const existing = (await db.collection("customers").get()).docs.map((d) => ({
  id: d.id,
  ...d.data(),
}));

const byName = new Map();
for (const c of existing) {
  const key = norm(`${c.firstName} ${c.lastName}`);
  if (key) byName.set(key, c);
}

function resolve(clientName) {
  const key = norm(clientName);
  const aliased = ALIASES.get(key) ?? key;
  return byName.get(aliased) ?? null;
}

/**
 * An invoice already represented by the Flyra import.
 *
 * Matched on customer and amount rather than on any id: the two systems share
 * no identifiers, and the same job invoiced twice for the same amount days
 * apart is far more likely to be one payment recorded in two places than two
 * genuine payments.
 */
function alreadyCounted(customer, total) {
  if (!customer || customer.lifetimeValue <= 0) return false;
  return Math.abs(customer.lifetimeValue - total) < 0.01;
}

// ---------------------------------------------------------------- group
/**
 * Grouped by the customer they resolve to, not by the name on the invoice.
 * "Steve Stacey" and "Steve Stacy" are one person; grouping on the raw string
 * produced two writes to the same document in the same batch, and the second
 * silently discarded the first one's revenue.
 */
const groups = new Map();

for (const inv of invoices) {
  const client = inv.Client;
  if (!client) continue;

  const match = resolve(client);
  const key = match ? `id:${match.id}` : `name:${norm(client)}`;

  const g = groups.get(key) ?? { client, match, rows: [], paid: 0, owed: 0 };
  g.rows.push(inv);
  g.paid += num(inv.Paid);
  g.owed += num(inv["Balance Due"]);
  groups.set(key, g);
}

const updates = [];
const creations = [];
let skippedOverlap = 0;

for (const [, g] of groups) {
  const match = g.match;

  // Dedupe against what the Flyra import already credited.
  const overlap = g.rows.filter((r) => alreadyCounted(match, num(r.Total)));
  const paid = g.paid - overlap.reduce((s, r) => s + num(r.Paid), 0);
  skippedOverlap += overlap.length;

  const email = g.rows.map((r) => r["Client Email"]).find(Boolean) ?? "";
  const lastPaid = g.rows
    .map((r) => usDate(r["Paid Date"]))
    .filter(Boolean)
    .sort((a, b) => a.toMillis() - b.toMillis())
    .at(-1);

  const lines = g.rows
    .map(
      (r) =>
        `${r.Invoice} ${r.Date} — $${r.Total}` +
        (num(r["Balance Due"]) > 0 ? ` UNPAID $${r["Balance Due"]}` : ` paid ${r["Paid Date"]}`),
    )
    .join("\n");

  const summary =
    `Legacy invoice history imported ${new Date().toISOString().slice(0, 10)} ` +
    `(${g.rows.length} invoice${g.rows.length === 1 ? "" : "s"}, ` +
    `$${g.paid.toFixed(2)} billed, $${g.owed.toFixed(2)} outstanding):\n${lines}` +
    (overlap.length > 0
      ? `\n\n${overlap.length} of these already counted from the Flyra import and were not added again.`
      : "");

  const suspect = DUPLICATE_SUSPECTS[norm(g.client)];

  if (match) {
    const alreadyRun = (match.notes ?? []).some((n) => String(n.text).startsWith(LEGACY_MARKER));
    if (alreadyRun && !FORCE) {
      console.log(`  skipped ${match.firstName} ${match.lastName} — already has a legacy import note`);
      continue;
    }
    updates.push({ customer: match, addPaid: paid, owed: g.owed, email, lastPaid, summary, suspect });
  } else {
    const [first, ...rest] = g.client.trim().split(/\s+/);
    creations.push({
      client: g.client,
      first,
      last: rest.join(" "),
      paid,
      owed: g.owed,
      email,
      lastPaid,
      summary,
      review: FLAG_FOR_REVIEW.has(norm(g.client)) ? REVIEW_HINT[norm(g.client)] : null,
      firstSeen: g.rows.map((r) => usDate(r.Date)).filter(Boolean).sort((a, b) => a.toMillis() - b.toMillis())[0],
    });
  }
}

// ---------------------------------------------------------------- report
console.log(`\n${invoices.length} invoices across ${groups.size} clients${DRY_RUN ? "  (dry run)" : ""}`);
console.log(`  matched to existing customers: ${updates.length}`);
console.log(`  new customers to create:       ${creations.length}`);
console.log(`  invoices skipped as overlap:   ${skippedOverlap}`);
console.log(
  `\nadds $${updates.reduce((s, u) => s + u.addPaid, 0).toFixed(2)} to existing lifetime values`,
);
console.log(
  `brings $${[...updates, ...creations].reduce((s, u) => s + u.owed, 0).toFixed(2)} of outstanding debt into the pipeline`,
);

const debtors = [...updates.map((u) => ({ name: `${u.customer.firstName} ${u.customer.lastName}`, owed: u.owed })), ...creations.map((c) => ({ name: c.client, owed: c.owed }))]
  .filter((d) => d.owed > 0)
  .sort((a, b) => b.owed - a.owed);

console.log("\nowes money:");
for (const d of debtors) console.log(`  ${d.name.padEnd(36)} $${d.owed.toFixed(2)}`);

if (DRY_RUN) {
  console.log("\nDry run — nothing written.\n");
  process.exit(0);
}

// ---------------------------------------------------------------- write
let seq = 0;
const note = (text, kind, createdAt) => ({
  id: `legacy-${(seq++).toString(36)}`,
  text,
  kind,
  authorUid: IMPORTER.uid,
  authorName: IMPORTER.displayName,
  createdAt: createdAt ?? Timestamp.now(),
});

const stampFields = () => ({
  updatedAt: Timestamp.now(),
  updatedBy: IMPORTER.uid,
  updatedByName: IMPORTER.displayName,
});

let written = 0;
const batch = db.batch();

for (const u of updates) {
  const notes = [...(u.customer.notes ?? []), note(u.summary, "lead_import")];
  if (u.suspect) notes.push(note(u.suspect, "note"));
  const patch = {
    notes,
    lifetimeValue: (u.customer.lifetimeValue ?? 0) + u.addPaid,
    ...stampFields(),
  };

  if (u.email && !u.customer.email) patch.email = u.email;
  if (u.lastPaid && !u.customer.lastContactedAt) patch.lastContactedAt = u.lastPaid;

  // Owing money outranks whatever stage they were parked in — that is the
  // column someone works down.
  if (u.owed > 0) {
    patch.pipelineStage = "awaiting_payment";
    // Set, not added. Whatever was there was the value of an open estimate —
    // money that might come in — and adding it to an invoice debt overstates
    // what is actually owed on the one column someone works down.
    patch.pipelineValue = u.owed;
    patch.pipelineChangedAt = Timestamp.now();
    patch.status = "customer";
    patch.tags = [...new Set([...(u.customer.tags ?? []), "owes-money"])];
  } else if (u.addPaid > 0 && u.customer.pipelineStage === "new_lead") {
    // Paid work makes someone a customer, not an untouched lead.
    patch.pipelineStage = "paid";
    patch.pipelineChangedAt = Timestamp.now();
    patch.status = "customer";
  }

  batch.set(db.collection("customers").doc(u.customer.id), patch, { merge: true });
  written++;
}

for (const c of creations) {
  const notes = [note(c.summary, "lead_import", c.firstSeen)];
  if (c.review) notes.push(note(c.review, "note"));

  batch.set(
    db.collection("customers").doc(`lg-${norm(c.client).slice(0, 14)}`),
    {
      firstName: c.first,
      lastName: c.last,
      phone: "",
      email: c.email,
      address: "",
      lat: 0,
      lng: 0,
      status: "customer",
      notes,
      tags: c.owed > 0 ? ["legacy", "owes-money"] : ["legacy"],
      serviceTypes: ["pressure_washing"],
      createdAt: c.firstSeen ?? Timestamp.now(),
      createdBy: IMPORTER.uid,
      createdByName: IMPORTER.displayName,
      lastContactedAt: c.lastPaid ?? null,
      lastContactedBy: IMPORTER.uid,
      lastContactedByName: IMPORTER.displayName,
      lifetimeValue: c.paid,
      pipelineStage: c.owed > 0 ? "awaiting_payment" : "paid",
      pipelineChangedAt: Timestamp.now(),
      pipelineValue: c.owed,
      source: "manual",
      sourceLeadId: `legacy:${norm(c.client)}`,
      ...stampFields(),
    },
    { merge: true },
  );
  written++;
}

await batch.commit();
console.log(`\nwrote ${written} customer records\n`);
