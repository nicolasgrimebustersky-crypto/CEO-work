# Grime Busters CRM

Door-to-door CRM for **Grime Busters KY LLC** — pressure washing, landscaping and
snow removal in Oldham County, KY. Built for a two-person crew working a
neighbourhood on foot: the map is the home screen, both phones see each other
live, and every note, text and job carries the name of whoever did it.

- **Stack:** Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS 4 ·
  Firebase (Auth, Firestore, Storage) · `@vis.gl/react-google-maps` · Twilio ·
  `next-pwa` · date-fns
- **Deploy target:** Vercel

---

## What's built

**Phase 1 — Map and customer database**

| Feature | Notes |
|---|---|
| Full-screen Google Map, satellite by default, satellite/hybrid/street toggle | `gestureHandling: greedy` so one finger pans |
| Live GPS, both crew as named colour dots, updating in real time | Writes throttled to 1 per 10s / 12m of movement |
| Tap a house to drop a pin, with the address reverse-geocoded | Nothing is written until you hit save |
| Colour-coded pins: gray lead, yellow quoted, green customer, red not interested, black do-not-knock | White outline keeps them legible on satellite |
| Pins sync between phones in seconds | Firestore realtime listeners |
| Filter by status, service, last-contacted window, and who logged it | Same filter code backs the map and the list |
| Searchable, sortable customer list | |
| Customer detail: contact, service history, job photos, notes timeline, revenue | |

**Phase 2 — Scheduling**

| Feature | Notes |
|---|---|
| Shared day / week / month calendar | Colour-coded by assignee; two assignees get a split stripe |
| Drag-and-drop rescheduling | Pointer-events based, so it works on touch |
| Create a job from any customer record | Service, time window, price, assign to either or both |
| Dragging a job texts the customer the new time | |
| Scheduling a job texts a confirmation immediately | |
| The other user gets an in-app notification on create / edit / complete | Bell with unread badge |
| Notifications for everything else — new customers, payments, texts back, leads | Same bell, plus push to the phone |
| Quiet hours — nothing buzzes 9pm–7am Eastern | The record still lands, so the bell is current in the morning |
| Day view in route order with drive time between stops | Filterable to "my jobs" / "all jobs" |
| Door-knocking routes: named, ordered, assigned, ticked off as you walk | Auto-ordered nearest-first from where you're standing |
| Territories: draw an area on the map, claim it, see what's inside | Drag a loop freehand; coverage counts pins actually spoken to |

**Phase 3 — SMS and automation**

| Feature | Notes |
|---|---|
| `POST /api/sms/send` — one-off text to a customer | |
| `POST /api/sms/blast` — text the filtered group currently on screen | Skips do-not-knock and missing numbers, capped at 200 |
| `GET /api/cron/quote-followups` — chases silent quotes | Every 4 days, 3 attempts, then marks declined |
| `GET /api/cron/money-reminders` — an invoice going past due, and a Monday total | Called out once per invoice, not daily |
| `POST /api/sms/inbound` — Twilio webhook for replies | Signature-verified |
| Every SMS in or out is logged to the customer timeline with the sender's name | |
| **Messages screen** — every conversation in one place, opening on who's waiting | Threads derived from the timeline, so there is only ever one copy |

**Phase 4 — Photos, dashboard, offline**

| Feature | Notes |
|---|---|
| Before/after camera capture straight to Firebase Storage | Opens the rear camera; downscaled in-browser before upload |
| Dashboard: today's jobs split by person, expected revenue, jobs done this week, open quotes, doors knocked | |
| Reports: revenue by month and by service, quote-to-close rate, best neighbourhoods, per-person breakdown | |
| PWA with offline support | Installable; queued writes and a visible sync state |

### Design rules the UI follows

- Mobile-first portrait. Primary controls sit in the bottom third, in thumb reach.
- Minimum 44px tap targets everywhere.
- Dark UI, one bright accent (`#00d9ff`), high contrast throughout — no thin
  grey text, because none of it is readable on a phone in direct sun.
- Each crew member gets one colour used identically for their map dot, calendar
  blocks, and attribution chips. Colours are assigned by uid sort order so both
  phones agree without coordination; a `color` field on the user document
  overrides it.
- Status colours are fixed by the data model and never reused for anything else.

---

## Picking this up cold

`docs/MASTER_PROMPT.md` is the brief for a fresh session with any AI assistant:
what the business is, what has been asked for and delivered, what is still
outstanding, and the rules that must not be broken while changing any of it.
Paste it as a first message and go from there.

---

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` using the steps below. Until the Firebase keys are set the
app shows a setup screen listing exactly which ones are still blank.

### 2. Create the Firebase project

1. [Firebase console](https://console.firebase.google.com/) → **Add project**.
   Analytics is not needed.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
   Leave passwordless sign-in off.
3. **Build → Firestore Database → Create database**, in **production mode** (the
   rules in this repo replace the default). `us-east1` or `us-central1` are
   closest to Kentucky.
4. **Build → Storage → Get started.** Same region. Needed for job photos.
5. **Project settings → General → Your apps → Web (`</>`)**. Register the app and
   copy the config into `.env.local`:

   | Firebase config key | `.env.local` variable |
   |---|---|
   | `apiKey` | `NEXT_PUBLIC_FIREBASE_API_KEY` |
   | `authDomain` | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` |
   | `projectId` | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` |
   | `storageBucket` | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` |
   | `messagingSenderId` | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
   | `appId` | `NEXT_PUBLIC_FIREBASE_APP_ID` |

   These are public by design — they identify the project, they do not grant
   access. Access comes entirely from the rules in step 4.

### 3. Create the two user accounts by hand

The app has no sign-up screen, so both accounts are made in the console:

1. **Authentication → Users → Add user.** Enter the first crew member's email and
   a password. Repeat for the second.
2. Copy both **User UIDs** — you need them in the next two steps.

The app creates each `users/{uid}` profile document automatically on first
sign-in. Set the display name and phone on the **Account** tab; the display name
is what appears on the map dot and on everything that person logs.

### 4. Deploy the Firestore and Storage rules

Replace the two placeholders in **both** `firestore.rules` and `storage.rules`
with the uids from step 3:

```
'REPLACE_WITH_FIRST_UID',
'REPLACE_WITH_SECOND_UID'
```

Then deploy rules and the one composite index the notification feed needs:

```bash
npx firebase login
npx firebase use --add          # pick the project you just created
npx firebase deploy --only firestore:rules,firestore:indexes,storage:rules
```

The allowlist is the entire access model — no roles, no permission tiers. An
account that exists in Firebase Auth but is missing from the list can sign in and
will then fail every read, which surfaces as an error banner on the Account tab.

Check the rules before trusting them:

```bash
npm run test:rules
```

That boots the Firestore emulator and runs `tests/firestore.rules.test.mjs`,
which asserts a non-allowlisted account gets nothing, anonymous callers get
nothing, one crew member cannot overwrite the other's GPS position, and no write
can be attributed to the wrong person.

### 5. Google Maps API key

1. In the [Google Cloud console](https://console.cloud.google.com/), select the
   project Firebase created (or any project with billing enabled — Maps needs a
   billing account, though the free tier covers a crew this size).
2. **APIs & Services → Library**, enable:
   - **Maps JavaScript API**
   - **Geocoding API** — reverse-geocodes a dropped pin into a street address
   - **Places API**
   - **Distance Matrix API** — *optional*. With it, the day view shows real road
     drive times between stops; without it, it falls back to straight-line
     estimates and labels them "(est.)".
3. **Credentials → Create credentials → API key.**
4. Restrict the key. An unrestricted Maps key is a billing incident waiting to
   happen:
   - **Application restrictions → Websites**: `http://localhost:3000/*`,
     `https://your-app.vercel.app/*`, `https://*.vercel.app/*` for previews, plus
     any custom domain.
   - **API restrictions → Restrict key**, selecting only the APIs above.
5. Put the key in `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

**Map ID (recommended).** Advanced Markers need one:
**Google Maps Platform → Map management → Create map ID**, type **JavaScript**.
Put it in `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. Left blank, the app falls back to
Google's `DEMO_MAP_ID`, which works but carries a demo watermark.

### 6. Service account, crew uids, cron secret

The SMS routes and the nightly cron run server-side with the Firebase Admin SDK.

1. **Firebase console → Project settings → Service accounts → Generate new
   private key.** Save the JSON.
2. Base64-encode it and put the result in `FIREBASE_SERVICE_ACCOUNT_KEY`:

   ```bash
   base64 -w0 service-account.json      # macOS: base64 -i service-account.json
   ```

   Base64 because Vercel's env editor mangles multi-line values. Raw JSON also
   works locally.

3. Set `CREW_UIDS` to both uids, comma-separated. The Admin SDK bypasses
   Firestore rules, so every API route re-checks the caller against this list.
   **Keep it in sync with the rules files.** Left empty, every API request is
   denied — that is deliberate: an SMS endpoint anyone can reach is toll fraud.

4. Set `CRON_SECRET` to a random string; Vercel sends it as a bearer token.

   ```bash
   openssl rand -hex 32
   ```

### 7. Twilio

1. Sign up at [twilio.com](https://www.twilio.com/) and verify your own mobile.
2. **Phone Numbers → Buy a number.** Filter to the **US**, area code **502** so
   texts come from a local Louisville number, and require **SMS**. Roughly
   $1.15/month plus per-message cost.
3. Copy the **Account SID** into `TWILIO_ACCOUNT_SID` and the number — E.164,
   e.g. `+15025550147` — into `TWILIO_PHONE_NUMBER`. The Account SID is an
   identifier, not a secret; it appears in Twilio's own REST URLs.

   For the sending credential, prefer an **API key** over the account auth
   token: **Account → API keys & tokens → Create API key**, then set
   `TWILIO_API_KEY_SID` and `TWILIO_API_KEY_SECRET`. A leaked API key is one
   deletion in the console; a leaked auth token means resetting the credential
   every integration on the account uses.

   Set `TWILIO_AUTH_TOKEN` **as well**. Twilio signs inbound webhooks with the
   account auth token and never with an API key secret, so without it
   `/api/sms/inbound` refuses every request — deliberately, rather than
   accepting messages it cannot prove came from Twilio.
4. **Wire up replies.** On the number's config page set **A message comes in** to
   `POST https://your-app.vercel.app/api/sms/inbound`. Replies then land on the
   customer's timeline. The route verifies Twilio's signature and rejects
   anything unsigned.
5. For business texting to US numbers you also need
   [A2P 10DLC registration](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc).
   Start it early — approval takes days.

These variables have **no** `NEXT_PUBLIC_` prefix, deliberately: they are only
read server-side inside `/api/*` route handlers. Never add the prefix — it would
ship a sending credential to every browser that loads the app, and anyone who
viewed source could text your customers on your bill.

### 8. Push notifications

The bell inside the app works with no setup. Getting a notification onto a phone
that is in a pocket with the app closed needs one key.

1. **Firebase console → Project settings → Cloud Messaging → Web configuration
   → Web Push certificates → Generate key pair.**
2. Copy the public key into `NEXT_PUBLIC_FIREBASE_VAPID_KEY`, locally and in
   Vercel. It is public by design — it is the `applicationServerKey` a browser
   needs to create a subscription.
3. On each phone: **Account → Notifications → turn the switch on**, and allow the
   permission prompt. That files a token for that device.

Leave the key blank and everything else still works — records, bell, badge,
settings — and the Account screen explains why the switch is missing rather than
showing a dead control.

Two things worth knowing:

- **On iPhone, push only works from the home screen.** Safari itself will not
  deliver Web Push; the app has to be installed with Share → Add to Home Screen
  and opened from there. The Account screen detects this and says so.
- **Sending is server-side**, through `/api/push/send`, which needs
  `FIREBASE_SERVICE_ACCOUNT_KEY` and `CREW_UIDS` from step 6. A client that
  could send push to another account could send it anything.

### 9. Run it

```bash
npm run dev          # http://localhost:3000
```

Location and the map both need a secure context. `localhost` counts, so this
works on a desktop browser. To test GPS on a real phone you need HTTPS — deploy a
Vercel preview and open that.

---

## Deploying to Vercel

1. Push to GitHub, then **Vercel → Add New → Project → Import**. The framework
   preset is detected; no build settings to change.
2. **Settings → Environment Variables**, adding every variable from
   `.env.example` for **Production**, **Preview** and **Development**:

   | Variable | Exposed to browser |
   |---|---|
   | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | yes |
   | `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | yes |
   | `NEXT_PUBLIC_FIREBASE_*` (six values) | yes |
   | `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | yes |
   | `FIREBASE_SERVICE_ACCOUNT_KEY` | **no — server only** |
   | `CREW_UIDS` | **no — server only** |
   | `CRON_SECRET` | **no — server only** |
   | `TWILIO_ACCOUNT_SID` | **no — server only** |
   | `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | **no — server only** |
   | `TWILIO_AUTH_TOKEN` | **no — server only** |
   | `TWILIO_PHONE_NUMBER` | **no — server only** |

   Leave `NEXT_PUBLIC_USE_FIREBASE_EMULATORS` unset in every Vercel environment.

3. Deploy, then add the deployment URL to the Maps key's website restrictions
   (step 5.4) and to **Firebase → Authentication → Settings → Authorised
   domains**. Sign-in fails with `auth/unauthorized-domain` until you do.

4. The quote follow-up cron is declared in `vercel.json` and picks itself up on
   deploy. It runs daily at **15:00 UTC** — 10am Eastern in winter, 11am in
   summer. Vercel cron schedules are always UTC; edit `vercel.json` to move it.

`NEXT_PUBLIC_` variables are inlined at build time, so changing one in Vercel
needs a redeploy to take effect.

---

## Local development

```bash
npm run dev          # dev server
npm run build        # production build
npm test             # typecheck + lint + security rules
npm run typecheck    # tsc --noEmit, strict mode
npm run lint         # eslint
npm run emulators    # Firebase Auth + Firestore + Storage emulators
npm run seed         # fill the running emulators with two crew + sample data
npm run test:rules   # firestore.rules and storage.rules, 30 tests
npm run test:api     # API auth and rate limits, 16 tests (boots its own stack)
npm run test:meta    # Meta webhook signature + field mapping, 17 tests
npm run build:native # UI-only static export (no API routes)
```

`test:api` is self-contained: it starts its own emulators on dedicated ports,
seeds two crew accounts, builds and boots the app against them, and uses
deliberately fake Twilio credentials so the routes are exercised without any
message being sent. It can run alongside a `npm run emulators` session.

All three suites also run in CI (`.github/workflows/ci.yml`) on every push.

To work against the emulators instead of the live project, set
`NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` in `.env.local` and run
`npm run emulators` in a second terminal. The emulator UI is at
`http://127.0.0.1:4000`. Data is in-memory and disappears on shutdown, which
makes it a safe place to try rules changes or fake customers.

The service worker is disabled in development — it would intercept HMR and serve
stale bundles. To exercise offline behaviour, run `npm run build && npm start`.

---

## How it is put together

```
app/
  layout.tsx              providers + auth gate + shell, applied to every route
  page.tsx                redirects / to /map
  map/                    the landing screen
  schedule/               day / week / month calendar
  customers/              list and detail
  dashboard/, reports/    today's numbers, and the longer view
  offline/                served by the service worker when a page isn't cached
  api/sms/send            one-off text
  api/sms/blast           filtered group text
  api/sms/inbound         Twilio reply webhook
  api/cron/quote-followups  nightly quote chaser
  api/cron/money-reminders  overdue invoices and Monday's outstanding total
  api/push/send           fans a notification out to the crew's devices
components/
  providers/              Auth, Team, Customers, Jobs, Notifications, Connection
  auth/                   login screen, setup screen, route gate
  map/                    map canvas, pins, teammate dots, sheets, filters
  knock/                  route list, the screen you hold while walking, door
                          picker, territory panel
  schedule/               calendar views, drag hook, job sheet, photo capture
  customers/              list, detail, notes timeline, quote/text/edit sheets
  dashboard/              today's numbers and reports
  messages/               the inbox and one conversation, with a reply box
  shell/                  nav, headers, notification bell, connection banner
  ui/                     buttons, fields, bottom sheet, chips
lib/
  firebase.ts             SDK init, emulator wiring, config checks
  db/                     Firestore reads and writes, one module per collection
  knock/plan.ts           route ordering and progress. No imports, so it is
                          testable by running it — and it owns the one haversine
  knock/territory.ts      point-in-polygon, area, coverage. Also import-free
  notifications/          the event catalogue: what exists, what it's called,
                          where it opens, and when it may interrupt you. No
                          imports, so both sides can use it
  push/                   permission, token registration, handing off to the API
  server/                 admin SDK, API auth, Twilio, push — all `server-only`
  schedule.ts             calendar maths
  driveTime.ts            Distance Matrix with a straight-line fallback
  filters.ts              filter + search logic, shared by map and list
  threads.ts              texts read back out of the notes as conversations
  useLiveLocation.ts      watchPosition with throttled Firestore writes
public/
  push-sw.js              the push service worker — no SDK, just `push`
tests/
  firestore.rules.test.mjs
firestore.rules           the uid allowlist — the whole client access model
storage.rules
vercel.json               the daily cron
```

There is exactly **one** realtime listener per collection, owned by a provider at
the root, rather than one per screen. That is what makes a pin dropped on one
phone appear on the other's map, list and detail screens at the same moment
without any of them refetching.

### Decisions worth knowing about

- **Every write is stamped, and the rules enforce it.** `createdBy` on create and
  a *refreshed* `updatedBy`/`updatedAt` on update. On an update
  `request.resource.data` is the merged document, so a payload that just omits
  `updatedBy` would inherit the stored value — the rules require `updatedAt` in
  the write diff specifically to close that.
- **API routes re-check the caller.** The Admin SDK bypasses Firestore rules
  entirely, so `requireCrew()` verifies the Firebase ID token (with
  `checkRevoked`) and confirms the uid is in `CREW_UIDS`. Unset means everything
  is denied.
- **Job texts are best-effort.** The job saves first; if Twilio then fails, the
  sheet stays open with a warning rather than closing as if the customer had been
  told.
- **GPS writes are throttled** to one per 10 seconds and 12m of movement.
  `watchPosition` fires several times a second while walking, and every one of
  those would be a billed write plus a snapshot on the other phone.
- **Drag-and-drop is pointer-event based**, not HTML5 drag-and-drop, which does
  not fire on touch. A 320ms long-press threshold keeps a drag from stealing a
  scroll, and the calendar auto-scrolls in both axes near the edges — seven day
  columns do not fit on a phone, so without horizontal auto-scroll you could not
  drag Monday to Friday.
- **Revenue is computed from completed jobs**, not read from the stored
  `lifetimeValue`, so the displayed figure cannot drift.
- **Offline** is Firestore's persistent IndexedDB cache doing the real work:
  reads come from cache and writes queue until reconnect. The connection banner
  reports that state (`hasPendingWrites`) rather than reimplementing it, and the
  "edited by [name] at [time]" stamp is what makes last-write-wins legible when
  two offline edits collide.

---

## Notes and known gaps

- **Map tiles are not cached offline.** Google's Maps terms of service forbid
  pre-caching or storing tiles, so the map needs signal. Customer data, the
  calendar and job photos all work offline; the map does not.
- **`npm audit` reports build-time advisories.** Most come from `next-pwa`'s old
  Workbox 6 dependency tree; the rest are `sharp` and `postcss` inside Next's own
  tree, which resolve with a Next patch release. None of it ships to the browser.
  `@ducanh2912/next-pwa` is the better-maintained drop-in if you want to switch.
- **One composite index is required** (`notifications`: `forUid` ASC,
  `createdAt` DESC), declared in `firestore.indexes.json`. If you skip
  `--only firestore:indexes`, the notification bell shows a message telling you
  to deploy it.
- **Inbound texts match customers by phone number** with a full-collection scan,
  since numbers are stored however they were typed at the door. That is fine for
  hundreds of customers; it would need an indexed normalised field at tens of
  thousands.
- **The map itself was never exercised at runtime during development** — the
  build environment has no Maps key and no outbound access to Google's tile
  servers. Everything else was verified end-to-end against the Firebase
  emulators; see below.

---

## Install it on a phone

The app installs from the browser — no app store, no review queue. Open it in
**Safari** on iPhone, tap **Share → Add to Home Screen**. On Android, Chrome
offers an install button. The app prompts you the first time and explains the
iOS steps, since Safari has no install button of its own.

Installed, it runs full screen, keeps its own launch image instead of flashing
white, and survives being backgrounded far better than a browser tab — which
matters when you reopen it at every third house.

One honest limitation: iOS suspends a web app's geolocation when it is
backgrounded, so a teammate's dot stops updating while their phone is locked.
It resumes as soon as they open the app. Genuine background tracking would need
a native build; that is in git history at `6661bdf` if it ever becomes worth it.

## Lead pipeline

Every customer sits at a stage: **New lead → Estimate sent → Accepted →
Scheduled → Awaiting payment → Paid**, plus **Lost**. The board is at
`/pipeline` — columns scroll horizontally, each showing its count and the money
in it, and a lead that has sat untouched for a week is flagged.

Stages move themselves off things you already do: sending a quote, accepting
one, booking a job, marking it complete, recording payment. Automation only ever
moves a lead *forward* — those events arrive out of order in real life (someone
schedules from a phone call, then records the quote afterwards) and dragging a
scheduled job back to "estimate sent" would be worse than not moving it. Going
backwards is a deliberate manual choice.

`pipelineStage` is separate from `customer.status` on purpose: one answers "what
does this lead need next", the other decides the map pin colour. They are kept
in step automatically, so marking a pin *not interested* also closes the deal.

## Facebook / Instagram leads

Lead form submissions land in the pipeline automatically, notify both phones,
and get an acknowledgement text. Setup — including the long-lived Page token
that everyone gets wrong — is in `docs/META_LEADS.md`.

## Security

`SECURITY.md` is the full picture: what the app enforces, what it deliberately
does not, and the console-side steps that no amount of code in this repo can do
for you. The short version of that last part, in priority order:

1. **Restrict the Google Maps key** to your domains, restrict it to the three
   APIs it needs, and set daily quota caps. A browser key is public by design —
   restrictions are the only thing between it and someone else's bill.
2. **Turn on Firebase App Check** (set `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, then
   enforce it in the console). It is the one control that stops a caller holding
   a valid token from talking to Firestore outside the app.
3. **Enable Vercel Deployment Protection** on Preview deployments, or every
   preview URL is a public copy of the CRM.
4. **Set a Twilio spending limit.** The app caps sends per user per hour; a
   billing cap catches everything the app cannot see.

## What was verified, and how

Three suites were run against the Firebase emulators with two real signed-in
accounts:

- **Security rules** (47 tests, `npm run test:rules`) — the allowlist, anonymous
  and non-allowlisted access, self-only profile writes, author stamps on
  customers and jobs, quote reassignment, notification forging, push tokens
  filed against the wrong account, field validation, and the Storage
  size/content-type/path rules.
- **API auth and rate limits** (16 tests, `npm run test:api`) — missing / bogus /
  non-crew tokens on both SMS routes, the recipient cap, the hourly spend
  ceiling, the cron secret (including that a valid user token is *not* accepted
  as one), unsigned Twilio webhooks, and the security headers.
- **UI, two browsers side by side** (37 assertions) — realtime propagation in
  both directions with correct per-user attribution, search and filters, job
  creation and its failure path, cross-device notifications, drag-to-reschedule
  including horizontal auto-scroll, quotes, dashboard, reports, the offline
  banner, editing a past job from a customer record, and customer deletion with
  its orphan warning. Also confirmed zero CSP violations on every screen.
- **Notifications** (28 assertions) — the feed rendering every event type with
  its category, each entry resolving to the right screen and landing there when
  tapped, the unread badge, the category switches saving and reloading, and the
  push panel explaining itself rather than showing a dead control. Plus the push
  service worker driven directly with four payload shapes, including the
  malformed ones, to confirm it always shows something — a browser revokes a
  subscription that handles a push silently.

The map screen's chrome renders and the page does not error, but the tiles,
pins and GPS dots could not be exercised without a Maps key — that is the first
thing to check once you add one.
