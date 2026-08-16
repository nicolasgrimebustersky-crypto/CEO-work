# Grime Busters CRM — master prompt

Everything an AI needs to pick this project up cold: what it is, what was asked
for, what exists, what does not, and the rules that must not be broken while
changing it.

**Where to use it.** Paste the whole `## The prompt` section as your first
message.

- **Claude Code, pointed at this repo** — the right home for anything that
  touches code. It can read the files, run the tests, drive a browser, and push.
- **Claude chat / any other assistant** — fine for planning, spec work, deciding
  what to build next, or drafting copy. It cannot see this repo, so anything it
  writes has to be carried back here by hand. Give it the prompt plus whichever
  files matter to the question.

Keep this file current. A stale master prompt is worse than none: it will
confidently describe a version of the app that no longer exists.

---

## The prompt

```text
You are working on Grime Busters CRM — a door-to-door service CRM built for
Grime Busters KY LLC, a two-person pressure washing, landscaping and snow
removal business in Oldham County, Kentucky (Louisville metro).

# Who uses it

Two people. Nicolas (the owner) and one crew member. That is the entire user
base, and it is the single most important design fact: there are no roles, no
permission tiers, no admin screens, no onboarding flow. Either you are one of
the two accounts and you can see everything, or you get nothing.

It is used one-handed, in portrait, outdoors, in direct sun, standing on
somebody's driveway, often with poor signal. Every design decision follows from
that:

- Mobile-first portrait. Primary controls in the bottom third, in thumb reach.
- Minimum 44px tap targets.
- No thin grey text anywhere. Every foreground colour is checked against the
  surface behind it; body text clears 4.5:1 and most of it clears 7:1.
- Offline has to work for customer data, the calendar and photos. The map does
  not work offline and cannot — Google's terms forbid caching tiles.

# Stack

Next.js 15 (App Router) · TypeScript strict · Tailwind CSS 4 · React 19 ·
Firebase (Auth, Firestore, Storage) · Twilio · Google Maps · Vercel · PWA via
next-pwa.

No state library, no component library, no ORM. Providers at the root own one
realtime listener per collection; screens read from context. That is what makes
a pin dropped on one phone appear on the other's map, list and detail screens at
the same moment without any of them refetching.

# Brand

- Canvas `#050607` (near-black), surfaces a few shades above it, hairline
  borders rather than heavy ones.
- **Cyan `#00d9ff` is what you TAP** — buttons, links, active tab, focus rings.
- **Green `#06a143` is what you EARN** — revenue, collected, paid, balance due.
  Sampled from the logo artwork, not chosen.
- Cream `#f1e3cd` and gold `#a37d39` where the UI touches the lockup.
- These two hues each mean exactly one thing and are never swapped. A button and
  a dollar figure must never be the same colour, or neither stands out.
- Poppins, loaded in app/layout.tsx.
- The logo is real artwork in assets/logo-source.png. Every icon, splash and
  favicon is generated from it by scripts/generate-icons.mjs. Never hand-edit a
  generated file; change the source and re-run.

# What exists

Map with satellite view, live GPS dots for both crew, tap-to-drop pins with
reverse-geocoded addresses, colour-coded by status, filterable by status,
service, last-contacted window and who logged it.

Customer list and detail: contact, service history, job photos, notes timeline,
revenue, lifetime value.

Shared day/week/month calendar with drag-and-drop rescheduling, jobs assigned to
either or both crew, day view in route order with drive times between stops.

Lead pipeline board: new lead → estimate sent → estimate accepted → job
scheduled → awaiting payment → paid, plus lost. Stages advance from the actions
that cause them, never by hand-editing a field.

Estimates and invoices ("Money" tab): line items with a name and a description,
quantity × price, per-line taxable toggle, flat discount, editable tax rate,
notes, due date. Payments by cash/check/card/Zelle/Venmo. Estimate → invoice in
one tap, once. A hand-written PDF writer in lib/pdf. View, download, or share via
the iOS share sheet. A price book that fills itself from the estimates you write.

Notifications across every area of the app — schedule, customers, money,
messages, leads — in the bell, and pushed to a phone with the app closed via FCM
and a dependency-free service worker. Five category switches on the Account
screen, plus quiet hours: nothing buzzes between 9pm and 7am Eastern, though the
record still lands so the bell is current in the morning.

A nightly cron chases money that has not come in — an invoice is called out once
the morning it passes its due date, and Monday brings a single line for
everything still outstanding.

Door-knocking routes: a named, ordered list of doors with a day and an
assignee. Ordered nearest-first from wherever you are standing, ticked off as
you walk, with the next door as a card carrying a Navigate button. Assigning one
notifies whoever it lands on.

A Messages screen: every text conversation in one place, opening on who is
waiting for a reply. Threads are read back out of the notes timeline rather than
stored twice, so there is only ever one copy of a message.

SMS: one-off, filtered blast, inbound reply webhook, and a nightly cron that
chases silent quotes three times then marks them declined. Every message in or
out lands on the customer's timeline.

Meta Lead Ads webhook: a Facebook or Instagram lead form creates a customer,
texts an acknowledgement and notifies both phones.

Dashboard, reports, PWA offline shell, demo mode.

# Rules that must not be broken

1. **NO AI FEATURES.** This was asked for explicitly and repeatedly. No AI
   estimate generation, no AI copy, no "smart" suggestions, no LLM calls
   anywhere in the product. The estimate builder is a plain builder that works
   like Invoice Fly. If a feature idea involves a model, it is the wrong idea.

2. **Verify by driving the real artifact, never by inspection.** Reading code
   and concluding it works is how three separate bugs shipped here — a colour
   token that made sixteen figures invisible, a contrast function that put white
   on pink at 2.85:1, and a save that left the editor open. Each was found by
   measuring, not by looking. Build it, run it, drive it with Playwright, assert
   on what the browser actually computed. Scratch audits go in a scratchpad, not
   the repo.

3. **Money goes through round2, always.** A total rendering as $1,160.7000001 on
   a customer's invoice destroys more trust than a missing feature. Discount
   comes off before tax and is spread proportionally across taxable and untaxed
   lines. Totals are stored as well as computed, so a document sent last March
   keeps showing the numbers it showed then.

4. **Document numbers are one shared sequence starting at 8904**, continuing
   from where Invoice Fly left off. Estimates and invoices share it. Two
   sequences means two documents can both be "number 12", which is an argument
   you cannot win with a customer holding both.

5. **Security rules are the whole access model.** Two uids, hard-coded in
   firestore.rules and storage.rules. Every collection is explicit; there is no
   catch-all match. Author stamps are enforced server-side so an attribution
   cannot be forged. Never add a permissive catch-all — rules are OR'd, so it
   widens access rather than restricting it.

6. **Secrets never get the NEXT_PUBLIC_ prefix.** Twilio credentials,
   FIREBASE_SERVICE_ACCOUNT_KEY, CREW_UIDS, CRON_SECRET, META_* are server-only.
   Anything NEXT_PUBLIC_ is inlined into the browser bundle at build time.

7. **Customer data never leaves the machine.** Real names, phone numbers,
   addresses and emails are in this system and the repository is public. Never
   commit an export, a CSV, a fixture built from real customers, or a screenshot
   containing them.

8. **Every write is stamped** with who did it and when, and the UI shows it.
   Two people editing the same record on two phones is the normal case.

9. **Fire-and-forget the secondary effects.** A failed text, a failed price-book
   update or a failed notification must never make a saved job look unsaved. The
   record is written first; the rest is best-effort and swallowed.

10. **Match the surrounding code.** Comment density is high and explains *why*,
    not what. Naming is plain English. No abbreviations. If a decision looks
    arbitrary, the comment says what the alternative was and why it lost.

# How work is verified here

- `npm test` — typecheck, lint, 64 unit tests, 47 security-rules tests against
  the Firebase emulators.
- `npm run test:rules` — rules only, needs the emulators.
- `npm run test:api` — API auth and rate limits.
- Playwright audits at 390×844 (iPhone) driving the real build in demo mode.
  Demo mode resets its in-memory store on every full page load, so a flow
  spanning two screens must navigate by clicking, never by reloading.
- Chromium is pre-installed at /opt/pw-browsers/chromium in the dev container.

# Deployment

Vercel, from the `main` branch of nicolasgrimebustersky-crypto/CEO-work.
Firebase project holds Auth, Firestore and Storage. Rules deploy with
`npx firebase deploy --only firestore:rules,firestore:indexes,storage:rules`.
The two crew accounts are created by hand in the Firebase console — there is no
sign-up screen and there must not be one.

# When you are asked for something

Do the thing asked. If the thing asked already exists, say so plainly and point
at where it is rather than rebuilding it — but check whether it actually works
first, because "it exists" and "it works" have come apart here before. If you
find a real problem next to what was asked, fix it and say what you fixed.
```

---

## Requirements ledger

Every request made across the project, and where it stands.

### Delivered

| Asked for | Where it lives |
|---|---|
| Door-to-door CRM for a two-person crew | The whole app |
| Satellite map, tap a house to drop a pin, address filled in | `components/map/`, `lib/geocode.ts` |
| Both crew visible as live dots | `lib/useLiveLocation.ts`, `TeamProvider` |
| Colour-coded pins, filters, search | `lib/filters.ts`, shared by map and list |
| Customer records with history, photos, notes, revenue | `components/customers/` |
| Shared calendar, drag to reschedule, texts the customer | `components/schedule/` |
| Texting: one-off, blast, replies logged, quote chasing | `app/api/sms/*`, `app/api/cron/` |
| Before/after photos from the camera | `lib/db/photos.ts` |
| Dashboard and reports | `app/dashboard`, `app/reports` |
| Installs on a phone, works offline | `next.config.ts` (next-pwa), `app/offline` |
| Lead pipeline board | `lib/pipeline.ts`, `app/pipeline` |
| Facebook / Instagram lead forms | `app/api/meta/leads`, `docs/META_LEADS.md` |
| A preview link before Firebase existed | `NEXT_PUBLIC_DEMO_MODE`, `lib/demo/` |
| **Estimate / invoice builder like Invoice Fly, no AI** | `components/documents/`, `lib/documents.ts` |
| Colour on the estimate and invoice | `lib/business.ts` `BRAND`, `lib/pdf/documentPdf.ts` |
| Service **description** saved and reused | `lib/db/services.ts` — the price book |
| No print dialog: view, download, or send | `components/documents/DocumentPreview.tsx`, `lib/pdf/share.ts` |
| UI to match the reference screenshots | The reskin — `app/globals.css`, `components/shell/` |
| The app's real colours | Cyan/green/black, green sampled from the logo |
| A modern, sleek logo, used everywhere | `scripts/generate-icons.mjs` from `assets/` |
| The real Grime Busters logo as the app icon | Same, driven from the supplied artwork |
| The logo in the drawer, not a black box | Black field keyed out to alpha |
| **Notifications for everything** | `lib/notifications/events.ts` + push |
| **Estimate → invoice without making one by hand** | `convertToInvoice`, one-time, dated |
| The website on the documents | `BUSINESS.website` → `grimebusterskyllc.com` |
| **Texting integrated, not buried in each customer** | `app/messages`, `lib/threads.ts` |
| Notifications that don't wake you at 3am | `lib/notifications/quietHours.ts` |
| Being chased about money nobody has paid | `app/api/cron/money-reminders` |
| **Door-knock routes you can build and assign** | `app/routes`, `lib/knock/plan.ts` |

### Blocked on you, not on code

These need somebody with account access. None of them are code problems.

1. **Rotate two credentials that were pasted into a chat.** The Maps API key
   `AIzaSyBbg…` and the service-account key id `5f47b772…`. Treat both as
   compromised: delete the service-account key in Google Cloud → IAM → Service
   Accounts → Keys, and regenerate the Maps key.
2. **Restrict the Maps key** — Google Cloud → Credentials → the key →
   Application restrictions → Websites, listing the Vercel domains. An
   unrestricted browser key is billable by anyone who finds it.
3. **Create the notifications composite index** (`forUid` ASC, `createdAt`
   DESC). Declared in `firestore.indexes.json`; the deploy was IAM-blocked. The
   bell shows a message naming the fix if it is missing.
4. **Set the push key.** Firebase console → Project settings → Cloud Messaging →
   Web Push certificates → Generate key pair → paste into
   `NEXT_PUBLIC_FIREBASE_VAPID_KEY` in Vercel. Until then the bell works and
   nothing reaches a closed phone.
5. **Twilio, from scratch.** Sign up, buy a 502 number, and start A2P 10DLC
   registration on day one — approval takes days to weeks and nothing sends
   until it clears. Then set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_PHONE_NUMBER`, plus `FIREBASE_SERVICE_ACCOUNT_KEY`, `CREW_UIDS` and
   `CRON_SECRET`.
6. **Run the "Place on map" backfill** for imported customers, which have
   addresses but no coordinates.
7. **Check three imported totals against your bank deposits** — they looked off
   in the migration: Rob McDowell ≈ $4,441, Kim Nestor $1,134.20,
   Carry Hern $1,590.
8. **Merge PR #13.** Eight commits — the entire Money tab, the reskin, the
   logo, notifications and push — are on that branch. Production still runs the
   code from before any of it.

### Open questions and known rough edges

- **Two quote systems coexist.** The old `quotes` collection (and the cron that
  chases them) still exists alongside the new documents model, so a customer
  page shows both "Estimates & invoices" and "Quick quotes". Folding the cron
  onto documents and retiring `quotes` is the obvious cleanup; it has not been
  done because it changes what the follow-up automation chases.
- **The map is unverified against a real Maps key.** The chrome renders and the
  page does not error, but tiles, pins and GPS dots have never been exercised
  with a live key.
- **iOS push needs the app on the home screen.** Safari itself will not deliver
  Web Push. The Account screen detects this and says so.

---

## If you are starting a fresh session

1. Paste the prompt above.
2. Say what you want.
3. Expect it to check the current state before building — several things in this
   app already exist and were assumed missing.
