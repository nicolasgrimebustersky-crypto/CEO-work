/**
 * Telling "there are critical vulnerabilities" apart from "npm could not tell
 * us".
 *
 * `npm audit` exits non-zero for both, and the CI step treated them the same:
 * any non-zero failed the build. That held until npm retired the endpoint the
 * bundled client calls, at which point every pull request went red on a
 * security gate that was not running at all — the worst of both, because a
 * check that is always red stops being read.
 *
 * The two cases are distinguishable from the JSON, and distinguishing them is
 * the whole of this module:
 *
 *   A real report carries `metadata.vulnerabilities`, a count per severity.
 *   That is an answer, and a critical in it fails the build.
 *
 *   A failed request carries `message` and `uri` naming the registry, and no
 *   counts at all. That is not an answer. Failing on it asserts something
 *   about the dependencies that nobody checked.
 *
 * Pure so both branches can be tested without a network, which matters here
 * more than usual: the case worth getting right is the one that only happens
 * when npm is down.
 */

export interface AuditFindings {
  kind: "findings";
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

export interface AuditUnavailable {
  kind: "unavailable";
  /** What npm said, for the CI log. */
  detail: string;
}

export interface AuditUnreadable {
  kind: "unreadable";
  detail: string;
}

export type AuditResult = AuditFindings | AuditUnavailable | AuditUnreadable;

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Reads `npm audit --json` output.
 *
 * Order matters. The counts are looked for first, so a real report is never
 * mistaken for an outage — a response that carries both (npm has changed shape
 * before) is an answer, and an answer is what we act on.
 */
export function readAuditReport(stdout: string): AuditResult {
  const text = String(stdout ?? "").trim();
  if (!text) {
    return { kind: "unreadable", detail: "npm audit produced no output." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON at all. Could be a proxy's HTML error page, could be npm
    // crashing. Either way nobody checked the dependencies.
    return {
      kind: "unreadable",
      detail: `npm audit did not return JSON: ${text.slice(0, 200)}`,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return { kind: "unreadable", detail: "npm audit returned a non-object." };
  }

  const root = parsed as Record<string, unknown>;
  const metadata = root.metadata as Record<string, unknown> | undefined;
  const counts = metadata?.vulnerabilities as Record<string, unknown> | undefined;

  if (counts && typeof counts === "object") {
    return {
      kind: "findings",
      critical: count(counts.critical),
      high: count(counts.high),
      moderate: count(counts.moderate),
      low: count(counts.low),
    };
  }

  // No counts. If it names the registry it is the endpoint failing, which is
  // the case worth reporting precisely — "npm is down" and "npm audit is
  // broken" send somebody to different places.
  const message = typeof root.message === "string" ? root.message : "";
  const uri = typeof root.uri === "string" ? root.uri : "";
  if (message || uri) {
    return {
      kind: "unavailable",
      detail: [message, uri].filter(Boolean).join(" — ").slice(0, 300),
    };
  }

  return {
    kind: "unreadable",
    detail: "npm audit returned JSON with no vulnerability counts and no error.",
  };
}

/**
 * What the CI step should do about it.
 *
 * Only a critical fails, which is the policy the step has always had — the
 * tripwire is for the next unauthenticated-RCE class advisory, not for every
 * transitive moderate. See docs/SECURITY_AUDIT.md.
 *
 * An unavailable audit does NOT fail. That is a deliberate trade and worth
 * being explicit about: it means an npm outage leaves one build unaudited
 * rather than leaving every build red. The alternative was tried by accident
 * this afternoon and the result was a security gate nobody could merge past
 * and everybody learned to ignore. The warning is loud, and the next run after
 * npm recovers audits the same tree.
 */
export function auditVerdict(result: AuditResult): { ok: boolean; summary: string } {
  if (result.kind === "findings") {
    const { critical, high, moderate, low } = result;
    const tally = `${critical} critical, ${high} high, ${moderate} moderate, ${low} low`;
    return critical > 0
      ? { ok: false, summary: `Critical vulnerabilities in production dependencies: ${tally}.` }
      : { ok: true, summary: `No critical vulnerabilities (${tally}).` };
  }

  if (result.kind === "unavailable") {
    return {
      ok: true,
      summary:
        `NOT AUDITED — npm's audit service did not answer: ${result.detail}. ` +
        "Dependencies were not checked on this run. Check https://status.npmjs.org, " +
        "and re-run once it recovers.",
    };
  }

  return {
    ok: true,
    summary: `NOT AUDITED — could not read npm audit's output: ${result.detail}`,
  };
}
