/**
 * The dependency audit CI step.
 *
 *   node --experimental-strip-types scripts/audit-deps.mjs
 *
 * Replaces a bare `npm audit --omit=dev --audit-level=critical`, which failed
 * the build on any non-zero exit and so could not tell a critical advisory
 * apart from npm's own service being down. When npm retired the audit endpoint
 * the bundled client calls, that turned every pull request red on a check that
 * was not auditing anything.
 *
 * The policy is unchanged: production dependencies only, and only a critical
 * fails. What changed is that "npm did not answer" is now said out loud
 * instead of being reported as a vulnerability — see lib/auditReport.ts for
 * the reasoning, and docs/SECURITY_AUDIT.md for what the gate is for.
 *
 * `npm audit --json` is asked for rather than the human format because the
 * JSON is what makes the two cases distinguishable. Its exit code is ignored
 * on purpose; the body is the signal.
 */
import { spawnSync } from "node:child_process";

import { auditVerdict, readAuditReport } from "../lib/auditReport.ts";

const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  // Big enough for a full report on a tree this size; the default 1MB has
  // truncated audit output on larger projects, and a truncated body parses as
  // "unreadable" rather than as the answer it nearly was.
  maxBuffer: 32 * 1024 * 1024,
});

if (run.error) {
  console.error(`Could not run npm audit: ${run.error.message}`);
  process.exit(1);
}

const result = readAuditReport(run.stdout ?? "");
const verdict = auditVerdict(result);

// npm's own warnings explain an outage better than a summary can, so they are
// kept rather than swallowed.
const stderr = (run.stderr ?? "").trim();
if (stderr) console.error(stderr);

console.log(verdict.summary);

if (!verdict.ok) {
  console.error("::error::" + verdict.summary);
  process.exit(1);
}

// A run that audited nothing is surfaced as a GitHub Actions warning, so it
// shows on the job summary rather than only in the log where nobody scrolls.
if (result.kind !== "findings") {
  console.log("::warning::" + verdict.summary);
}
