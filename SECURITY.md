# Security

This app holds customers' names, phone numbers, home addresses, photographs of
their houses, signed estimates, and a button that spends money on SMS. This
document says plainly what protects it, what does not, and what only you can
do from the Google, Vercel, Resend and Twilio consoles.

**No honest version of this document says the app cannot be hacked.** What it
can say is that the obvious ways in are closed, the expensive ways in are
capped, every refusal is recorded, and the remaining risk is concentrated in a
small number of places you control.

A line-by-line audit against a published checklist is in
[`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md). Backups are in
[`docs/BACKUPS.md`](docs/BACKUPS.md).

---

## What's in place

### Identity — who can get in at all

- **Sign-up is open and grants nothing.** Registering writes a `pending`
  profile that the rules deny every customer, job and invoice. One account —
  the admin, identified by email on the token, never by a stored field — can
  approve it. Two bootstrap uids are crew unconditionally so a bad write can
  never lock the owners out.
- **Every sign-in needs an emailed six-digit code.** The password alone opens
  nothing. Verified sign-ins are recorded on the account as a list of
  sign-in moments (`otpAuths`), and the rules allow a session only if its own
  `auth_time` is in that list — so one device passing never unlocks another.
  Codes: salted-hash storage, ten-minute expiry, five tries, rate-limited.
  Five wrong tries emails the account's owner.
- **Sessions are checked for revocation.** API routes verify ID tokens with
  `checkRevoked: true`.
- **No cookies.** Firebase keeps its session in IndexedDB; routes take a
  bearer token.

### Data — what a valid session may do

- **Rules deny by default** and every allow names a collection and a
  condition. `isCrew()` requires the sign-in code. Author stamps are enforced
  on every write, and updates must refresh `updatedAt` so a stamp cannot be
  inherited. Shape checks on enums, coordinates and prices.
- **Per-person boundaries** where they exist: your own notifications, chats
  you are a member of, your own profile (never your own `role`).
- **Collections no client can reach:** `otpCodes`, `rateLimits`. **Admin only,
  verified sign-in only:** `apiKeys`, `auditLog`.
- **Storage** is `jobs/{jobId}/{file}`, images, 15 MB, crew with a verified
  sign-in.
- 137 rules tests, `npm run test:rules`.

### API routes — the part rules do not protect

Every route runs on the Admin SDK, which bypasses rules, so each re-checks
the caller — crew, approved, *and* past the sign-in code. Rate limits cap
spend: texts, blasts, drafts, pushes, sign-in codes, code guesses, MCP calls,
each per account or per key. The cron routes use a separate secret. The
inbound Twilio webhook verifies Twilio's signature. The one unauthenticated
write — a customer answering their own estimate — can only move a document
from draft/sent to accepted/declined, writes only that customer's record, and
is rate-limited per link. 66 tests against a running server, `npm run
test:api`.

### The Ops Agent (MCP)

Keys are generated in-app, stored as SHA-256 hashes, and carry explicit
scopes; texting real people is a scope issued on its own. No tool returns
customer-written text to the agent. Every call and every refusal is audited.

### The audit log

`auditLog`: who did what, to what, whether it worked, from which IP. Written
by the server only, readable by the admin only. Covers sign-in codes, crew
refusals, every MCP call, revoked keys being presented, texts, blasts,
pushes, drafts and customer quote answers. The people it records cannot edit
it.

### Transport and browser

In `next.config.ts`, tested in `tests/api.auth.test.mjs`: CSP
(destination-constrained — `unsafe-inline` stays because Next's bootstrap and
Google Maps need it), `frame-ancestors 'none'` + `X-Frame-Options: DENY`,
HSTS two years preload, `nosniff`, `Referrer-Policy`, `Permissions-Policy`,
`X-Robots-Tag: noindex`, COOP, no `X-Powered-By`, `no-store` on `/api/*`.

### Dependencies

`npm ci` from a committed lockfile; no dependency runs an install script; CI
fails on any critical advisory in a production dependency. What remains and
why is in the audit document.

---

## What you have to do — none of this lives in the repo

1. **Backups.** `docs/BACKUPS.md`, sections 1 and 2, today.
2. **Resend domain.** Verify `grimebusterskyllc.com` and set
   `NOTIFY_EMAIL_FROM`, or only the key's owner can receive sign-in codes.
3. **Google Maps key.** Restrict to your domains and to the three Maps APIs;
   set daily quota caps. It ships in the client bundle by design.
4. **Firebase App Check.** Register reCAPTCHA v3, set
   `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, watch, then enforce for Firestore and
   Storage. Already wired in `lib/firebase.ts`.
5. **Firebase Auth.** Authorised domains: only yours. Email enumeration
   protection on.
6. **Vercel.** Deployment Protection is on (verified). Turn on the Firewall's
   Attack Challenge Mode and a `/api/*` rate-limit rule.
7. **Twilio.** Set a spending limit.
8. **IAM.** Remove `claude-session-readonly-371@…` if no longer needed.
9. **Two-factor** on GitHub, Vercel, Google Cloud, Resend and Twilio.
10. **Secrets.** `FIREBASE_SERVICE_ACCOUNT_KEY` bypasses everything above.
    Vercel env vars and `.env.local` only. If it leaks, revoke in Google
    Cloud → IAM → Service Accounts → Keys.

---

## Known limitations

- Both crew members can read and write everything. Either compromised
  account, past its sign-in code, is a total compromise of the data.
- Deleting a customer does not delete their jobs, quotes or photos.
- Rate-limit windows are fixed, not sliding.
- The sign-in code is emailed. Email is as secure as the mailbox; a
  compromised mailbox plus a compromised password is a way in.
- CSP allows inline scripts. Constraining destinations is the value; script
  form is not constrained.
- The map needs a live connection; Google's terms forbid caching tiles.

## Reporting a problem

Private two-person application. Fix on a branch; run `npm test` and
`npm run test:api`; a human merges.
