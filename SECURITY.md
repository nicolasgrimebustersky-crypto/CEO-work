# Security

This app holds customers' names, phone numbers, home addresses, photographs of
their houses, and a button that spends money on SMS. This document says plainly
what protects it, what does not, and what only you can do from the Google and
Vercel consoles.

**No honest version of this document says the app cannot be hacked.** What it
can say is that the obvious ways in are closed, that the expensive ways in are
capped, and that the remaining risk is concentrated in a small number of places
you control.

---

## What's in place

### Identity — who can get in at all

- **Two accounts, created by hand.** There is no sign-up route anywhere in the
  app. Accounts exist only because someone made them in the Firebase console.
- **A uid allowlist is the entire authorisation model.** `firestore.rules` and
  `storage.rules` reject every uid that is not one of the two. An attacker who
  registers their own Firebase account against the same project gets a valid
  session and then fails every single read and write.
- **Sessions are checked for revocation.** API routes verify ID tokens with
  `checkRevoked: true`, so disabling an account in the console kills its access
  immediately rather than whenever its hour-long token happens to expire.

### Data — what a valid session may do

- **Author stamps are enforced server-side.** A write must be attributed to the
  caller. On updates the rules require `updatedAt` to appear in the write diff,
  because `request.resource.data` is the *merged* document on an update — a
  payload that simply omits `updatedBy` would otherwise inherit the stored value
  and pass. That is what makes "edited by [name] at [time]" trustworthy.
- **One person cannot overwrite the other's GPS position** — profile writes are
  restricted to the owning uid.
- **A quote cannot be reassigned** to the other crew member after the fact, and
  a notification cannot be created attributed to someone else.
- **Shape validation** on status enums, coordinates, and prices, so a bug in one
  client cannot write a document the other client fails to render.
- **Storage is limited to `jobs/{jobId}/{file}`**, images only, 15 MB maximum.
  Nothing else in the bucket is writable.
- All of the above is covered by `npm run test:rules` (30 tests).

### API routes — the part rules do not protect

The SMS and cron routes run with the Firebase Admin SDK, which **bypasses
security rules entirely**. They are therefore the softest surface in the app,
and they are gated separately:

- **Every route re-checks the caller** against `CREW_UIDS`. If that variable is
  unset, every request is denied rather than allowed — an SMS endpoint anyone
  can reach is toll fraud waiting to happen.
- **The cron endpoint uses a separate shared secret**, and a valid crew ID token
  is explicitly *not* accepted in its place. Different trust domains.
- **Rate limits cap the spend.** 40 one-off texts and 4 group blasts per user
  per hour. A session that passes the allowlist has proved *who* it is, not *how
  much* it may spend; without a ceiling, one compromised phone could empty the
  Twilio balance in minutes and every message would look authorised on the way
  out. Counters live in Firestore, not memory, because serverless instances
  don't share memory and an in-process limiter would reset on cold start and be
  evadable with parallel requests.
- **Blasts are capped at 200 recipients** and skip anyone marked do-not-knock.
- **The inbound Twilio webhook verifies Twilio's signature.** Unsigned requests
  are refused — otherwise anyone who guessed the URL could write arbitrary notes
  into a customer's timeline.
- Covered by `npm run test:api` (16 tests).

### Transport and browser

Set in `next.config.ts`, verified in the API test suite:

| Header | Effect |
|---|---|
| `Content-Security-Policy` | Constrains where scripts load from, where the page may connect, and what may embed it |
| `frame-ancestors 'none'` + `X-Frame-Options: DENY` | Clickjacking |
| `object-src 'none'` | Plugin/embed vectors |
| `base-uri 'self'` | `<base>` tag injection |
| `Strict-Transport-Security` | 2 years, `includeSubDomains`, preloadable |
| `X-Content-Type-Options: nosniff` | MIME confusion |
| `Referrer-Policy` | Stops customer-record URLs leaking to third parties |
| `Permissions-Policy` | Grants only geolocation and camera; denies mic, payment, USB |
| `X-Robots-Tag: noindex` | A private CRM has no business in a search index |
| `poweredByHeader: false` | No framework/version fingerprint |
| `Cache-Control: no-store` on `/api/*` | No proxy or service worker caching of API responses |

**A caveat on CSP.** `script-src` permits `'unsafe-inline'` and `'unsafe-eval'`.
That is not laziness: Next injects an inline bootstrap script and the Google
Maps JS API evaluates code it fetches at runtime. Removing them needs a
nonce-issuing middleware and would still break the map. The value here is in
constraining *destinations*, not script forms. If a future change breaks the
map, set `CSP_REPORT_ONLY=true` to downgrade to reporting while you find the
missing source — do not delete the policy.

---

## What you have to do — none of this lives in the repo

### 1. Restrict the Google Maps key (highest priority)

A Maps browser key ships inside the client JavaScript. It is public by design;
it cannot be hidden. The only thing standing between it and someone else's
billing charges is the restriction list:

- **Application restrictions → Websites**: your Vercel domain and any custom
  domain. Nothing else. An unrestricted key gets scraped and used.
- **API restrictions → Restrict key**: only Maps JavaScript, Geocoding, Places.
- **Set a daily quota cap** on each API under *APIs & Services → Quotas*. This
  is what converts a leaked key from an unbounded bill into a capped one.
- **Rotate the key if it has ever been pasted anywhere** — a chat, a ticket, a
  screenshot.

### 2. Turn on Firebase App Check

The rules can only ask *who are you*. App Check asks *are you the actual app*,
and it is the one control that meaningfully stops a caller who has somehow
obtained a valid token from talking to Firestore directly.

1. **Firebase console → App Check → Apps → Register**, provider **reCAPTCHA v3**.
2. Put the site key in `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`; the app wires it up
   automatically when that variable is present.
3. Watch the metrics for a few days, then **switch enforcement on** for
   Firestore and Storage.

### 3. Lock down Firebase Auth

- **Authentication → Settings → Authorised domains**: remove everything except
  your real domains. Delete `localhost` once you stop developing.
- **Enable email enumeration protection** (Settings → User actions).
- Consider **turning off account creation entirely** for the project once both
  accounts exist.
- Use real passwords. Two accounts with weak passwords defeats everything above.

### 4. Vercel

- **Project → Settings → Deployment Protection**: turn on **Vercel
  Authentication** for Preview deployments. Otherwise every preview URL is a
  public copy of your CRM.
- **Firewall** (Project → Firewall): enable **Attack Challenge Mode** if you
  ever see automated traffic, and add a rate-limit rule on `/api/*` as a second
  layer in front of the application-level limits.
- Confirm `FIREBASE_SERVICE_ACCOUNT_KEY`, `CREW_UIDS`, `CRON_SECRET` and the
  three Twilio variables are **not** prefixed `NEXT_PUBLIC_`. That prefix would
  publish them to every browser that loads the app.

### 5. Twilio

- Set a **spending limit** on the account. Application rate limits protect
  against a compromised session; a billing cap protects against everything else.
- Keep the auth token out of anything client-side. If it ever leaks, roll it in
  the console immediately — a leaked Twilio token is directly monetisable.

### 6. Service account key

`FIREBASE_SERVICE_ACCOUNT_KEY` is the most dangerous secret in the system: it
bypasses every security rule in this repo. Store it only in Vercel's env vars
and your local `.env.local`. Never commit it, never paste it. If it leaks,
revoke that key in **Google Cloud → IAM → Service Accounts → Keys** and issue a
new one.

---

## Known limitations

- **Both crew members can read and write everything, including deleting
  records.** That is the requested model — no roles, no tiers. It means either
  compromised account is a total compromise of the data.
- **Deleting a customer does not delete their jobs, quotes, or photos.** Orphans
  render as "Unknown customer" rather than disappearing.
- **Inbound texts match customers by scanning the collection**, because numbers
  are stored however they were typed at the door. Fine for hundreds of records;
  it would need an indexed normalised field at tens of thousands.
- **Rate limit windows are fixed, not sliding.** A caller can use their full
  hourly allowance at the end of one window and again at the start of the next.
  Acceptable for a spend ceiling; not a defence against a determined attacker.
- **No audit log separate from the data.** Author stamps live on the documents
  themselves, so anyone who can write a document can rewrite its stamp to
  another *valid* value — they just cannot attribute it to the other person.
- **The map requires a live connection.** Google's terms forbid caching tiles.

## Reporting a problem

This is a private two-person application with no public deployment. If you find
something, fix it on a branch and run `npm test` plus `npm run test:api` before
merging.
