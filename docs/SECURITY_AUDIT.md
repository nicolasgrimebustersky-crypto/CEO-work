# Security audit — items 37–54

A line-by-line pass over the second half of a "securitymaxxing" checklist,
against this codebase as it actually is. Each item says one of three things:

- **Done in code** — with the file that does it and the test that proves it.
- **Yours to configure** — a switch in Google, Vercel, Resend or Twilio that
  the repository cannot flip. The exact place is named.
- **Accepted, with reasons** — a finding that was looked at and deliberately
  left, and why.

Nothing here is marked done because it sounded done. Where a claim can be
tested, the test is named; where it cannot, that is said.

| # | Item | Status |
|---|---|---|
| 37 | Vulnerable dependencies | Done in code + CI gate; 9 accepted |
| 38 | Malicious packages | Done in code (lockfile, no install scripts) |
| 39 | Prompt injection | Done in code |
| 40 | Unpermissioned AI access | Done in code |
| 41 | Excessive DB permissions | Done in code; one item yours |
| 42 | Missing audit logs | Done in code |
| 43 | No security monitoring | Done in code; one item yours |
| 44 | No backups / restore | Yours to configure — runbook in `docs/BACKUPS.md` |
| 45 | Exposed internal dashboards | Verified configured |
| 46 | Missing security headers | Done in code, tested |
| 47 | Insecure cookie settings | Not applicable — no cookies |
| 48 | Unencrypted data | Done; nothing sensitive stored in the clear |
| 49 | Poor tenant isolation | Done in code — single tenant, per-person boundaries tested |
| 50 | Unreviewed code | Done — CI review gates on every PR |
| 51 | Mass assignment | Done in code — every write names its fields |
| 52 | Command injection | Not applicable — no shell, no `eval` |
| 53 | Insecure deserialisation | Not applicable — `JSON.parse` only, on validated shapes |
| 54 | Misconfigured OAuth | Not applicable in app; two items yours |

---

## 37. Vulnerable dependencies

**Before:** `npm audit --omit=dev` reported 20 (1 critical — an unauthenticated
RCE advisory against the installed `next`). **After:** 0 critical, 0 high in
runtime code.

Done:
- `next` 15.5.22 → 15.5.25 (the critical, patched within 15.x).
- `firebase-admin` 13 → 14.4.0.
- `firebase-tools` 14 → 15.30.1 (dev only, but it carried a `tar` critical).
- `next-pwa` 5.6.0 (unmaintained since 2022) replaced by the maintained fork
  `@ducanh2912/next-pwa` 10.2.9. Same options; the workbox ones moved under
  `workboxOptions` in `next.config.ts`. The build regenerates `public/sw.js`.
- **CI gate:** `.github/workflows/ci.yml` now runs
  `npm audit --omit=dev --audit-level=critical`. A future critical in a
  production dependency fails the build.

Accepted (9 remaining in production dependencies, none critical):
- `postcss` (high, ×4) via `next`. Source-map and `</style>` handling in
  PostCSS's *stringifier* — runs at **build time** on this repository's own
  CSS. No user input reaches PostCSS. Fixed only in Next 16, which is a major
  upgrade to schedule on its own, not fold into a security pass.
- `serialize-javascript` (high) via `@rollup/plugin-terser` via
  `workbox-build`. Runs at **build time** to minify the service worker. No
  attacker-controlled input.
- 7 moderates (`uuid`, `gaxios`, `stream-json`, `@opentelemetry/core`,
  `csv-parse`, and the workbox pair) — transitive, mostly through
  `firebase-tools`, which is a dev tool. Re-checked on each `npm ci` in CI.

## 38. Malicious packages

- `package-lock.json` is committed and CI installs with `npm ci`, so the
  resolved set is pinned — a poisoned newer version of a transitive cannot
  arrive silently.
- **No dependency runs an install script.** Checked across every production
  dependency's `package.json` for `preinstall`/`install`/`postinstall`: none.
- Ten direct production dependencies, all first-party to their platforms
  (`firebase`, `firebase-admin`, `next`, `react`, `twilio`,
  `@anthropic-ai/sdk`, `@vis.gl/react-google-maps`, `date-fns`,
  `server-only`, `@ducanh2912/next-pwa`).

## 39. Prompt injection

Two places text meets a model.

**Estimate drafting** (`lib/server/estimateAI.ts`): the operator's dictation
is now wrapped in `<dictation>` tags, any such tags in the input are stripped
first, and the system prompt states that the tagged text describes work and is
never an instruction. The output is constrained to a JSON schema
(`output_config.format`) and re-validated (`usableItems`), so the worst a
successful injection can do is put odd words on a line item the operator then
reads before accepting. It cannot change prices — those are computed here,
never by the model.

**The MCP server** (`lib/mcp/`): checked which tools return customer-*written*
text to the agent. None do. `find_customer`, `list_leads` and `list_jobs`
return crew-entered fields (name, address, phone, status, amounts); timeline
notes and inbound texts — the only customer-authored text in the database —
are not exposed by any tool. `add_note` and `send_sms` take text *from* the
agent and store it attributed to the key, never the other way round.

## 40. Unpermissioned AI access

- `ANTHROPIC_API_KEY` is server-only (no `NEXT_PUBLIC_` prefix; README table).
- The only route that spends it, `/api/estimate/draft`, requires a crew
  session **that has entered its sign-in code** (`requireCrew`), then a rate
  limit (30/hour per user). Tested in `tests/api.auth.test.mjs`.
- The MCP server is gated by hashed API keys with explicit scopes; the
  `send` scope (texting real people) is issued separately. Tested against a
  running server in `tests/api.mcp.test.mjs`.

## 41. Excessive DB permissions

- **Client:** `firestore.rules` and `storage.rules` deny by default; every
  allow names a collection and a condition. Crew can only act from a
  verified sign-in. `otpCodes`, `rateLimits`, `auditLog` and `apiKeys` are
  unreachable from any client (the last two: admin only). 137 rules tests.
- **Server:** the Admin SDK bypasses rules by design; every route re-checks
  the caller (`lib/server/auth.ts`), including the sign-in code.
- **Yours:** the service account
  `claude-session-readonly-371@grimeline-5e3d8.iam.gserviceaccount.com` was
  granted `roles/datastore.viewer` over the whole database during an earlier
  session. If it is no longer needed, remove it — Google Cloud → IAM.

## 42. Missing audit logs

New: `lib/server/audit.ts` writes an `auditLog` collection with action,
actor, target, outcome, one line of detail, client IP and user agent. Wired
into: sign-in code sent / verified / wrong / locked; crew refusals (not crew,
code required); every MCP tool call and scope refusal; a revoked API key
being presented; SMS send, blast and test; push sends; estimate drafts; and
customer quote answers. Message bodies are never recorded — the timeline
already holds them.

Rules: readable by the admin from a verified sign-in only; writable by nobody
(the Admin SDK bypasses rules). The people it records cannot edit it. Tested
(four cases) in `tests/firestore.rules.test.mjs`.

Deliberately *not* logged: unauthenticated hits with made-up API keys. Each
would be a Firestore write an anonymous scanner could trigger for free.

## 43. No security monitoring

Done in code:
- **Lockout alert.** Five wrong sign-in codes cancels the code and emails the
  account's owner (`lockoutEmail`) — the one sign-in event that is somebody
  with the password and without the mailbox.
- Every refusal above lands in `auditLog` with an IP.

Yours:
- Vercel → project → **Firewall**: enable Attack Challenge Mode, and add a
  rate-limit rule on `/api/*` as a layer in front of the application limits.
- Vercel → **Logs**: runtime errors are aggregated per route; the two crons
  and every route log failures with `console.error`.

## 44. No backups / restore

Firestore is not backed up by default. `docs/BACKUPS.md` is the runbook:
point-in-time recovery, a daily backup schedule, an on-demand export, the
Auth user export, Storage versioning, and — the part most runbooks skip — how
a restore actually gets back into the `(default)` database. Every command
needs `gcloud` with owner rights on the project, so it is yours to run.

## 45. Exposed internal dashboards

Verified via the Vercel API: **Vercel Authentication is on for all
deployments except custom domains**, so every preview URL is behind a Vercel
login. `passwordProtection` off, `trustedIps` off — neither is needed with SSO
on. The Firebase emulator UI (port 4000) is local only. `/api/version` is
public by design and returns one commit hash — nothing that is not already in
this repository's history.

## 46. Missing security headers

Already present in `next.config.ts` and **tested** against a running server
(`tests/api.auth.test.mjs`): CSP (destination-constrained; see the caveat on
`unsafe-inline` there), `frame-ancestors 'none'` + `X-Frame-Options: DENY`,
HSTS two years with preload, `nosniff`, `Referrer-Policy`,
`Permissions-Policy`, `X-Robots-Tag: noindex`, COOP, `poweredByHeader: false`,
`Cache-Control: no-store` on `/api/*`.

## 47. Insecure cookie settings

**The app sets no cookies.** Firebase Auth keeps its session in IndexedDB;
API routes take a bearer token. `grep` for `cookie` across `app/`, `lib/`,
`components/`: no matches. `localStorage` holds two preferences (location
sharing on/off, install-prompt dismissed) and nothing else.

## 48. Unencrypted data

- In transit: HTTPS only (Vercel), HSTS with preload, CSP
  `upgrade-insecure-requests`. No `http://` in the codebase outside emulator
  addresses.
- At rest: Firestore and Storage are encrypted by Google.
- Secrets: API keys stored as SHA-256 hashes (`lib/apiKeys.ts`); sign-in codes
  as salted SHA-256 (`lib/server/otp.ts`); Twilio, Resend, Anthropic and the
  service account live in server-only environment variables.
- Customer names, addresses and phone numbers are stored as plain fields.
  That is the data the app exists to hold; the controls above are what
  protect it.

## 49. Poor tenant isolation

Single tenant by design: one business, two people. Where per-person
boundaries exist they are enforced in rules and tested: notifications are
readable only by their addressee; team-chat threads only by their members;
profiles' `role` and `notificationScopes` only writable by the admin; the
customer share link resolves one document by a 192-bit token and returns a
narrowed payload (`lib/server/publicDocument.ts` — an internal-only note is
asserted absent in `tests/api.shareLink.test.mjs`).

## 50. Unreviewed code

Every PR runs typecheck, lint, 576 unit tests, 137 rules tests, the API suite
against a live server, the build, and now the dependency audit. Two automated
reviews (Codex gate, Claude) run on each PR. `CLAUDE.md` forbids pushing to
`main` or merging; a human merges.

## 51. Mass assignment

Checked every server-side write (`app/api/**`, `lib/server/**`,
`lib/mcp/handlers.ts`): none spreads a request body into a document. Each
names its fields and coerces its types (`str()`, `numberOf()`, `typeof`
checks). The one spread in the codebase (`app/api/quote/[token]/route.ts`)
feeds a validator, not a write. Client writes go through typed patch
functions in `lib/db/*`, and the rules independently refuse the fields that
matter (`role`, `notificationScopes`, author stamps).

## 52. Command injection

No `child_process`, `exec`, `spawn` or shell in `app/`, `lib/` or
`components/`. Scripts in `scripts/` are operator tools run by hand.

## 53. Insecure deserialisation

Only `JSON.parse`, always followed by a shape check (`typeof`,
`Array.isArray`, a validator). No `eval`, `new Function`, `vm`, YAML, or
pickle-style formats. The service-account key is base64-decoded and
`JSON.parse`d with the three needed fields checked by type.

## 54. Misconfigured OAuth

The app uses no OAuth provider: Firebase email/password plus the emailed
code; the MCP server uses bearer keys. Nothing to misconfigure in code.

Yours:
- Firebase → Authentication → Settings → **Authorised domains**: only your
  real domains. Remove `localhost` when not developing.
- The platform accounts that *can* deploy this — GitHub, Vercel, Google Cloud,
  Resend, Twilio — should each have **two-factor authentication on**. A
  compromised Vercel login can read every environment variable.
