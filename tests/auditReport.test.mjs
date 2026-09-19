/**
 * Telling a vulnerability apart from an outage.
 *
 * The case this exists for happened: npm retired the endpoint the bundled
 * client calls, `npm audit` started exiting non-zero on every run, and the CI
 * step reported it as a failed security gate. Every pull request went red on a
 * check that was not checking anything — and a check that is always red is one
 * people learn to merge past.
 *
 * Both fixtures below are real output captured during that outage.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { readAuditReport, auditVerdict } = await import("../lib/auditReport.ts");

/** What npm 10.9.7 returned when the /quick endpoint was retired. */
const RETIRED_ENDPOINT = JSON.stringify({
  message: "400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick - Bad Request",
  method: "POST",
  uri: "https://registry.npmjs.org/-/npm/v1/security/audits/quick",
  headers: { "npm-notice": ["This endpoint is being retired."] },
});

/** What npm@latest returned the same afternoon, from the live endpoint. */
const SERVICE_DOWN = JSON.stringify({
  message: "503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
  uri: "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
});

const report = (counts) =>
  JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: counts } });

describe("reading npm audit output", () => {
  test("a clean report is findings, not an error", () => {
    const result = readAuditReport(report({ critical: 0, high: 0, moderate: 0, low: 0 }));
    assert.equal(result.kind, "findings");
    assert.equal(result.critical, 0);
  });

  test("counts are read per severity", () => {
    const result = readAuditReport(report({ critical: 2, high: 3, moderate: 7, low: 1 }));
    assert.deepEqual(
      { critical: result.critical, high: result.high, moderate: result.moderate, low: result.low },
      { critical: 2, high: 3, moderate: 7, low: 1 },
    );
  });

  test("a retired endpoint is unavailable, not a finding", () => {
    const result = readAuditReport(RETIRED_ENDPOINT);
    assert.equal(result.kind, "unavailable");
    assert.match(result.detail, /400/);
    assert.match(result.detail, /registry\.npmjs\.org/);
  });

  test("a service outage is unavailable too", () => {
    const result = readAuditReport(SERVICE_DOWN);
    assert.equal(result.kind, "unavailable");
    assert.match(result.detail, /503/);
  });

  test("an answer is never mistaken for an outage", () => {
    // A response carrying both — npm has changed shape before — is an answer.
    const both = JSON.stringify({
      message: "something happened",
      uri: "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
      metadata: { vulnerabilities: { critical: 1, high: 0, moderate: 0, low: 0 } },
    });
    const result = readAuditReport(both);
    assert.equal(result.kind, "findings");
    assert.equal(result.critical, 1);
  });

  test("garbage is unreadable rather than silently fine", () => {
    for (const junk of ["", "   ", "<html>502 Bad Gateway</html>", "null", "[]", "42"]) {
      const result = readAuditReport(junk);
      assert.equal(result.kind, "unreadable", JSON.stringify(junk));
    }
  });

  test("nonsense counts do not become findings", () => {
    const result = readAuditReport(report({ critical: "lots", high: -3, moderate: null }));
    assert.equal(result.kind, "findings");
    assert.equal(result.critical, 0, "a non-number is not a vulnerability");
    assert.equal(result.high, 0, "a negative count is not a vulnerability");
  });
});

describe("what CI does about it", () => {
  test("a critical fails the build", () => {
    const verdict = auditVerdict(readAuditReport(report({ critical: 1, high: 0, moderate: 0, low: 0 })));
    assert.equal(verdict.ok, false);
    assert.match(verdict.summary, /Critical/);
  });

  test("highs and moderates do not — that is the standing policy", () => {
    // The gate is a tripwire for the next unauthenticated-RCE class advisory,
    // not a wall that goes red on every transitive moderate.
    const verdict = auditVerdict(readAuditReport(report({ critical: 0, high: 9, moderate: 40, low: 2 })));
    assert.equal(verdict.ok, true);
    assert.match(verdict.summary, /No critical/);
    assert.match(verdict.summary, /9 high/, "still says what was found");
  });

  test("an outage does not fail the build, and says loudly that nothing was checked", () => {
    const verdict = auditVerdict(readAuditReport(SERVICE_DOWN));
    assert.equal(verdict.ok, true);
    assert.match(verdict.summary, /NOT AUDITED/);
    assert.match(verdict.summary, /status\.npmjs\.org/, "points at where to look");
  });

  test("unreadable output also says nothing was checked", () => {
    const verdict = auditVerdict(readAuditReport("<html>502</html>"));
    assert.equal(verdict.ok, true);
    assert.match(verdict.summary, /NOT AUDITED/);
  });

  test("a passing audit never claims NOT AUDITED", () => {
    // The two summaries must not be confusable at a glance in a CI log.
    const verdict = auditVerdict(readAuditReport(report({ critical: 0, high: 0, moderate: 0, low: 0 })));
    assert.doesNotMatch(verdict.summary, /NOT AUDITED/);
  });
});
