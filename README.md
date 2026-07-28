# Grime Busters CRM

Door-to-door CRM for **Grime Busters KY LLC** — pressure washing, landscaping and
snow removal in Oldham County, KY. Built for a two-person crew working a
neighbourhood on foot: the map is the home screen, both phones see each other
live, and every note carries the name of whoever wrote it.

- **Stack:** Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS 4 ·
  Firebase (Auth, Firestore, Storage) · `@vis.gl/react-google-maps` · Twilio · date-fns
- **Deploy target:** Vercel

---

## What works today (Phase 1)

| # | Feature | Status |
|---|---|---|
| 1 | Full-screen Google Map, satellite by default, satellite/hybrid/street toggle | Done |
| 2 | Live GPS via `watchPosition()`, both crew shown as named colour dots in real time | Done |
| 3 | Tap a house to drop a pin; quick-entry form with reverse-geocoded address | Done |
| 4 | Colour-coded pins: gray lead, yellow quoted, green customer, red not interested, black do-not-knock | Done |
| 5 | Pins sync between phones in seconds via Firestore realtime listeners | Done |
| 6 | Filter by status, service type, last-contacted window, and who logged it | Done |
| 7 | Searchable, sortable customer list as an alternative to the map | Done |
| 8 | Customer detail: contact info, service history, job photos, notes timeline, total revenue | Done |

Phases 2–4 (scheduling, SMS automation, photos/dashboard/offline) are not built
yet. The data model, security rules and design system already account for them,
and the places they plug in are marked in the code.

### Deliberate design choices

- **The map is the landing route.** `/` redirects to `/map`; there is no menu screen.
- **Sign-in only.** No registration route exists anywhere in the app. Accounts are
  created by hand in the Firebase console, and the Firestore rules reject any uid
  outside the two-account allowlist.
- **Every write is stamped.** `createdBy` / `updatedBy` / note authorship are
  enforced by the security rules, not just by the client, so an attribution
  cannot be forged by running modified code with a valid session.
- **GPS writes are throttled** to at most one per 10 seconds and only after 12 m
  of movement. `watchPosition` fires several times a second while walking;
  writing every fix would burn Firestore quota and spam the other phone.
- **Offline-tolerant reads and writes.** Firestore is initialised with a
  persistent IndexedDB cache, so the app keeps working in dead spots between
  subdivisions and flushes queued writes on reconnect. The full offline queue
  and conflict UI land in Phase 4.

---

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local
```

Then fill in `.env.local` using the steps below. Nothing works until the
Firebase and Google Maps keys are set — until then the app shows a setup screen
listing exactly which keys are still blank.

### 2. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) → **Add project**.
   Google Analytics is not needed.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
   Leave "Email link (passwordless sign-in)" off.
3. **Build → Firestore Database → Create database.** Start in **production mode**
   (the rules in this repo replace the default). Pick the `us-east1` or
   `us-central1` region — both are close to Kentucky.
4. **Build → Storage → Get started.** Same region. Needed for Phase 4 job photos.
5. **Project settings → General → Your apps → Web (`</>`)**. Register the app,
   then copy the config values into `.env.local`:

   | Firebase config key | `.env.local` variable |
   |---|---|
   | `apiKey` | `NEXT_PUBLIC_FIREBASE_API_KEY` |
   | `authDomain` | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` |
   | `projectId` | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` |
   | `storageBucket` | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` |
   | `messagingSenderId` | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
   | `appId` | `NEXT_PUBLIC_FIREBASE_APP_ID` |

   These are public by design — they identify the project, they do not grant
   access. Access is controlled entirely by the security rules in step 4.

### 3. Create the two user accounts by hand

The app has no sign-up screen, so both accounts are created in the console:

1. **Authentication → Users → Add user.** Enter the first crew member's email and
   a password. Repeat for the second.
2. Copy each **User UID** from the list — you need both for the next step.

That is the only way to add an account. Anyone who signs up through some other
route still gets rejected by the rules, because their uid is not on the allowlist.

The app creates each person's `users/{uid}` profile document automatically on
first sign-in. Set the display name and phone on the **Account** tab — the
display name is what appears on the map dot and on every note that person writes.

### 4. Deploy the Firestore and Storage rules

Open `firestore.rules` and `storage.rules` and replace the two placeholders in
**both** files with the uids from step 3:

```
'REPLACE_WITH_FIRST_UID',
'REPLACE_WITH_SECOND_UID'
```

Then deploy:

```bash
npx firebase login
npx firebase use --add          # select the project you just created
npx firebase deploy --only firestore:rules,storage:rules
```

The allowlist is the entire access model — there are no roles or permission
tiers. An account that exists in Firebase Auth but is missing from this list can
sign in and will then fail every read, which shows up in the app as an error
banner on the Account tab.

Verify the rules do what you think before deploying:

```bash
npm run test:rules
```

This boots the Firestore emulator and runs `tests/firestore.rules.test.mjs`,
which checks that a non-allowlisted account gets nothing, that anonymous callers
get nothing, that one crew member cannot overwrite the other's GPS position, and
that no write can be attributed to the wrong person.

### 5. Google Maps API key

1. In the [Google Cloud console](https://console.cloud.google.com/), select the
   same project Firebase created (or any project with billing enabled — Maps
   requires a billing account, though the monthly free tier covers a crew this size).
2. **APIs & Services → Library**, and enable all three:
   - **Maps JavaScript API**
   - **Geocoding API** (reverse-geocodes a dropped pin into a street address)
   - **Places API**
3. **APIs & Services → Credentials → Create credentials → API key.**
4. Restrict the key — an unrestricted Maps key is a billing incident waiting to happen:
   - **Application restrictions → Websites**, and add:
     - `http://localhost:3000/*` (local development)
     - `https://your-app.vercel.app/*`
     - `https://*.vercel.app/*` if you want preview deploys to work
     - your custom domain, if you add one
   - **API restrictions → Restrict key**, and select only the three APIs above.
5. Put the key in `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

**Map ID (recommended).** Advanced Markers need one. Go to
**Google Maps Platform → Map management → Create map ID**, map type **JavaScript**,
raster or vector both work, and put it in `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. If you
leave it blank the app falls back to Google's `DEMO_MAP_ID`, which renders fine
but carries a demo watermark.

### 6. Twilio (needed from Phase 3)

1. Sign up at [twilio.com](https://www.twilio.com/) and verify your own mobile number.
2. **Phone Numbers → Buy a number.** Filter to the **US**, area code **502** so
   texts come from a local Louisville number, and require the **SMS** capability.
   Around $1.15/month plus per-message cost.
3. From the console dashboard copy the **Account SID** and **Auth Token** into
   `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`, and the number you bought — in
   E.164 form, e.g. `+15025550147` — into `TWILIO_PHONE_NUMBER`.
4. For business texting to US numbers you will also need
   [A2P 10DLC registration](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc);
   do it early, approval takes days.

These three variables have **no** `NEXT_PUBLIC_` prefix, and that is deliberate:
they are only ever read server-side inside `/api/sms/*` route handlers. Never add
the prefix — it would ship your auth token to every browser that loads the app.

### 7. Run it

```bash
npm run dev          # http://localhost:3000
```

Location and the map both need a secure context. `localhost` counts as secure, so
this works in a desktop browser. To test GPS on an actual phone you need HTTPS —
the simplest route is to deploy a Vercel preview and open that on the phone.

---

## Deploying to Vercel

1. Push this repo to GitHub, then **Vercel → Add New → Project → Import**.
   The framework preset is detected automatically; no build settings to change.
2. **Settings → Environment Variables**, and add every variable from
   `.env.example` for **Production**, **Preview** and **Development**:

   | Variable | Exposed to browser |
   |---|---|
   | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | yes |
   | `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | yes |
   | `NEXT_PUBLIC_FIREBASE_API_KEY` | yes |
   | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | yes |
   | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | yes |
   | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | yes |
   | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | yes |
   | `NEXT_PUBLIC_FIREBASE_APP_ID` | yes |
   | `TWILIO_ACCOUNT_SID` | **no — server only** |
   | `TWILIO_AUTH_TOKEN` | **no — server only** |
   | `TWILIO_PHONE_NUMBER` | **no — server only** |

   Leave `NEXT_PUBLIC_USE_FIREBASE_EMULATORS` unset in every Vercel environment.

3. Deploy, then go back and add the real deployment URL to the Google Maps key's
   website restrictions (step 5.4) and to **Firebase → Authentication → Settings →
   Authorised domains**. Sign-in fails with `auth/unauthorized-domain` until you do.

`NEXT_PUBLIC_` variables are inlined at build time, so changing one in Vercel
requires a redeploy to take effect.

---

## Local development

```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit, strict mode
npm run lint         # eslint
npm run emulators    # Firebase Auth + Firestore + Storage emulators
npm run test:rules   # security rules tests against the emulator
```

To work against the emulators instead of the live project, set
`NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` in `.env.local` and run
`npm run emulators` in a second terminal. The emulator UI is at
`http://127.0.0.1:4000`. Data is in-memory and disappears on shutdown, which
makes it a safe place to try rules changes or fake customers.

---

## How it is put together

```
app/
  layout.tsx              providers + auth gate + shell, applied to every route
  page.tsx                redirects / to /map
  map/page.tsx            the landing screen
  customers/page.tsx      list view
  customers/[id]/page.tsx detail view
  account/page.tsx        profile, team roster, sign out
components/
  providers/              AuthProvider, TeamProvider, CustomersProvider
  auth/                   login screen, setup screen, route gate
  map/                    map canvas, pins, teammate dots, sheets, filters
  customers/              list, detail, notes timeline, edit sheet
  ui/                     buttons, fields, bottom sheet, chips
lib/
  firebase.ts             SDK init, emulator wiring, config checks
  db/                     Firestore reads and writes, one module per collection
  types.ts                the data model
  filters.ts              filter + search logic, shared by map and list
  useLiveLocation.ts      watchPosition with throttled Firestore writes
tests/
  firestore.rules.test.mjs
firestore.rules           the uid allowlist — the whole access model
storage.rules
```

There is exactly **one** realtime listener per collection, owned by a provider at
the root, rather than one per screen. That is what makes a pin dropped on one
phone appear on the other's map, list and detail screens at the same moment
without any of them refetching.

### Design rules the UI follows

- Mobile-first portrait. Primary controls sit in the bottom third, in thumb reach.
- Minimum 44 px tap targets everywhere.
- Dark UI, single bright accent (`#00d9ff`), high contrast throughout — no thin
  grey text, because none of it is readable on a phone in direct sun.
- Each crew member gets one colour, used identically for their map dot, their
  attribution chips, and (in Phase 2) their calendar blocks. Colours are assigned
  by uid sort order so both phones agree without any coordination; a `color`
  field on the user document overrides it.
- Status colours are fixed by the data model and never reused for anything else.

---

## Notes and known gaps

- **`next-pwa` is installed but not enabled.** It is wired up in Phase 4. Turning
  it on before the offline write queue exists would cache stale customer data
  with no way to reconcile it. It also pulls in an old Workbox 6 tree, which is
  where most of `npm audit`'s build-time warnings come from; nothing there ships
  to the browser today. `@ducanh2912/next-pwa` is the better-maintained drop-in if
  you would rather switch when Phase 4 starts.
- **`npm audit` also flags `sharp` and `postcss`** through Next's own dependency
  tree. Those resolve with a Next patch release, not from this repo.
- **No composite Firestore indexes are needed yet.** Per-customer job and quote
  queries sort client-side on purpose, since one customer's history is a handful
  of documents. Phase 2's calendar queries will need real indexes;
  `firestore.indexes.json` is in place for them.
- **The map was verified against real Google Maps behaviour only in code**, not
  in the build environment — that sandbox has no Maps key and no outbound access
  to Google's tile servers. Everything else in Phase 1, including two-user
  realtime sync and the rules allowlist, was verified end-to-end against the
  Firebase emulators with two signed-in accounts.
