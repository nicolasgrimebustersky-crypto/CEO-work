/**
 * Publishes what the agent system is doing into GrimelineCRM, where the
 * command centre at /marcus reads it.
 *
 * This is the bridge between the two halves: the agents run here, on a
 * machine, as shell scripts and `claude -p` calls; the dashboard runs in the
 * browser against Firestore. Nothing on that screen is invented — every row it
 * shows came through this script, which means an agent that stops running
 * stops appearing to work. That is the entire point: see HEARTBEAT_STALE_MS in
 * lib/ops/types.ts, which turns a stale heartbeat into "NOT REPORTING" rather
 * than leaving a stopped agent looking busy.
 *
 * Same safety shape as create-estimate.ts and log-lead.ts: it signs in as a
 * crew user, never a service account, so firestore.rules applies to every
 * write exactly as it applies to the app. It cannot touch customers, jobs,
 * estimates or users — only the three ops collections.
 *
 * What it cannot do, by design: decide an approval. The rules only accept a
 * decision from a signed-in crew member on a row that is still pending, and
 * this script never writes one. Money and legal stop with Nicolas — hard rule
 * 1 — and an agent that could approve its own spend would make that decorative.
 *
 * Usage:
 *   node --experimental-strip-types scripts/ops-publish.ts <command> [flags]
 *
 *   agent     --id cole --status working|waiting|idle --task "what you're on"
 *   feed      --who cole --text "what you did"
 *   approval  --kind money|content|escalation|legal --who cole
 *             --title "..." [--detail "..."] [--cost "~$3.40 SMS"]
 *             [--approve-label "Approve & send"] [--alt-label "..."]
 *             [--a-who "Reese — offers" --a-pos "..."]
 *             [--b-who "Avery — research" --b-pos "..."]
 *             [--read "Marcus's own read"]
 *   decisions [--json]      what Nicolas has decided, for the agent to act on
 *
 * Add --dry-run to any command to print the document without writing it.
 *
 * Requires in grimebusters-ops/.env: CREW_EMAIL, CREW_PASSWORD,
 * NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
 * NEXT_PUBLIC_FIREBASE_PROJECT_ID (the same block create-estimate.ts uses).
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
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getFirestore } from "firebase/firestore";

const OPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const AGENT_IDS = ["marcus", "grant", "cole", "reese", "avery", "tyler"];
const AGENT_STATUSES = ["working", "waiting", "idle"];
const APPROVAL_KINDS = ["money", "content", "escalation", "legal"];

const COLLECTIONS = {
  agents: "opsAgents",
  feed: "opsFeed",
  approvals: "opsApprovals",
};

function die(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

// Same .env reader as create-estimate.ts and log-lead.ts, same single-quote
// rule: a double-quoted value containing $NAME is refused by name rather than
// silently reaching Firebase as a different string than bash would have seen.
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

function required(name: string): string {
  const value = arg(name);
  if (!value || !value.trim()) die(`--${name} is required`);
  return value.trim();
}

function oneOf(name: string, allowed: string[]): string {
  const value = required(name);
  if (!allowed.includes(value)) {
    die(`--${name} must be one of: ${allowed.join(", ")} (got "${value}")`);
  }
  return value;
}

const command = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!command || command.startsWith("--")) {
  die("first argument must be a command: agent, feed, approval, decisions");
}

const env = loadEnv();
for (const key of [
  "CREW_EMAIL",
  "CREW_PASSWORD",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
]) {
  if (!env[key]) die(`${key} is not set in grimebusters-ops/.env`);
}

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

/* ------------------------------------------------------------------ agent */

if (command === "agent") {
  const id = oneOf("id", AGENT_IDS);
  const status = oneOf("status", AGENT_STATUSES);
  const task = required("task");
  if (task.length > 300) die("--task is capped at 300 characters by the rules");

  const payload = {
    status,
    task,
    // serverTimestamp() is what the rules require: `heartbeatAt == request.time`.
    // A client clock would let a machine with a wrong time look current.
    heartbeatAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  if (dryRun) {
    console.log(`DRY RUN — ${COLLECTIONS.agents}/${id}:`, {
      ...payload,
      heartbeatAt: "<server time>",
      updatedAt: "<server time>",
    });
    process.exit(0);
  }

  const ref = doc(db, COLLECTIONS.agents, id);
  await setDoc(ref, payload, { merge: true }).catch((error: Error) =>
    die(`write rejected for agent "${id}": ${error.message}`),
  );

  // Read it back before claiming it landed.
  const check = await getDoc(ref).catch((error: Error) =>
    die(`wrote ${id} but could not read it back: ${error.message}`),
  );
  if (!check.exists()) die(`wrote ${id} but no document is there`);
  console.log(`${id}: ${status} — ${task}`);
  process.exit(0);
}

/* ------------------------------------------------------------------- feed */

if (command === "feed") {
  const who = oneOf("who", AGENT_IDS);
  const text = required("text");
  if (text.length > 2000) die("--text is capped at 2000 characters by the rules");

  const payload = {
    who,
    text,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
  };

  if (dryRun) {
    console.log(`DRY RUN — ${COLLECTIONS.feed}:`, {
      ...payload,
      createdAt: "<server time>",
    });
    process.exit(0);
  }

  const ref = await addDoc(collection(db, COLLECTIONS.feed), payload).catch(
    (error: Error) => die(`write rejected for feed entry: ${error.message}`),
  );
  console.log(`logged ${who}: ${text} (${ref.id})`);
  process.exit(0);
}

/* --------------------------------------------------------------- approval */

if (command === "approval") {
  const kind = oneOf("kind", APPROVAL_KINDS);
  const who = oneOf("who", AGENT_IDS);
  const title = required("title");
  if (title.length > 200) die("--title is capped at 200 characters by the rules");
  const detail = arg("detail")?.trim() ?? "";
  if (detail.length > 2000) die("--detail is capped at 2000 characters");

  const aWho = arg("a-who")?.trim();
  const aPos = arg("a-pos")?.trim();
  const bWho = arg("b-who")?.trim();
  const bPos = arg("b-pos")?.trim();
  const hasA = Boolean(aWho && aPos);
  const hasB = Boolean(bWho && bPos);

  // An escalation with one side is not an escalation, it is an argument with
  // the other person's case left out. Both or neither.
  if (hasA !== hasB) {
    die("an escalation needs both sides: --a-who/--a-pos and --b-who/--b-pos");
  }
  if (kind === "escalation" && !hasA) {
    die("--kind escalation requires both positions, as argued");
  }

  const payload = {
    kind,
    who,
    title,
    detail,
    cost: arg("cost")?.trim() ?? null,
    positionA: hasA ? { who: aWho!, position: aPos! } : null,
    positionB: hasB ? { who: bWho!, position: bPos! } : null,
    marcusRead: arg("read")?.trim() ?? null,
    approveLabel: arg("approve-label")?.trim() ?? "Approve",
    altLabel: arg("alt-label")?.trim() ?? (hasB ? `Go with ${bWho}` : null),
    // Lands pending, with no decision on it. The rules refuse anything else on
    // create — an agent cannot raise a request that is already approved.
    status: "pending",
    decidedAt: null,
    decidedBy: null,
    decidedByName: null,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
  };

  if (dryRun) {
    console.log(`DRY RUN — ${COLLECTIONS.approvals}:`, {
      ...payload,
      createdAt: "<server time>",
    });
    process.exit(0);
  }

  const ref = await addDoc(collection(db, COLLECTIONS.approvals), payload).catch(
    (error: Error) => die(`write rejected for approval: ${error.message}`),
  );
  console.log(`raised ${kind} approval: ${title} (${ref.id})`);
  console.log("waiting on Nicolas — this script cannot decide it");
  process.exit(0);
}

/* -------------------------------------------------------------- decisions */

if (command === "decisions") {
  // What Nicolas has answered. The agent that raised the item reads this and
  // does the work; nothing is carried out by the dashboard itself.
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.approvals), where("status", "!=", "pending")),
  ).catch((error: Error) => die(`could not read approvals: ${error.message}`));

  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      status: data.status,
      kind: data.kind,
      who: data.who,
      title: data.title,
      decidedByName: data.decidedByName ?? null,
      decidedAt:
        data.decidedAt && typeof data.decidedAt.toDate === "function"
          ? data.decidedAt.toDate().toISOString()
          : null,
    };
  });

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
  } else if (rows.length === 0) {
    console.log("no decisions yet");
  } else {
    for (const row of rows) {
      console.log(
        `${row.status.toUpperCase().padEnd(9)} ${row.title} — ${row.decidedByName ?? "?"} ${row.decidedAt ?? ""}`,
      );
    }
  }
  process.exit(0);
}

die(`unknown command "${command}" — try: agent, feed, approval, decisions`);
