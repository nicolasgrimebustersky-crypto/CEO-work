# Getting a live link

The fastest path to a URL you can open on your phone.

---

## The two-minute version

1. Go to **[vercel.com/new](https://vercel.com/new)** and sign in with GitHub.
2. **Import** `nicolasgrimebustersky-crypto/CEO-work`.
3. **Branch:** `claude/door-to-door-service-crm-bg4nkv` (Vercel defaults to
   `main`, which does not have the app on it yet — change this or you will
   deploy an empty repo).
4. Framework preset is detected. Do not change the build settings.
5. Add the environment variables below.
6. **Deploy.**

You get `https://<project>.vercel.app`, plus a fresh preview URL on every push.

---

## Environment variables

You do **not** need all of them to get a working link. There are three tiers.

### Tier 1 — required, or the app just shows a setup screen

| Variable | Where from |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase console → Project settings → Your apps → Web |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | same |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | same |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | same |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | same |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | same |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | the `AIza…` key you already have |

With just these you get the whole app: map, pins, live GPS, pipeline,
scheduling, photos, dashboard, reports. Everything except sending texts.

### Tier 2 — texting

| Variable | Notes |
|---|---|
| `TWILIO_ACCOUNT_SID` | |
| `TWILIO_AUTH_TOKEN` | |
| `TWILIO_PHONE_NUMBER` | E.164, e.g. `+15025550147` |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | base64 of the service-account JSON |
| `CREW_UIDS` | both uids, comma-separated |
| `CRON_SECRET` | `openssl rand -hex 32` |

Without these, the SMS buttons return a clear "Twilio is not configured on this
deployment" rather than failing silently. Scheduling a job still works — the
job saves and the sheet warns that the confirmation text did not send.

### Tier 3 — Facebook leads

`META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`,
`META_PAGE_ID`. See `docs/META_LEADS.md`.

### Also worth setting

- `NEXT_PUBLIC_SITE_URL` — your final URL, e.g. `https://grimebusters.vercel.app`.
  Used to allow your own origin through CORS.
- Leave `NEXT_PUBLIC_USE_FIREBASE_EMULATORS` **unset**. Setting it points the
  live app at emulators that do not exist.

`NEXT_PUBLIC_` variables are baked in at build time, so changing one needs a
redeploy to take effect. The server-side ones are read per request.

---

## Two things to do straight after the first deploy

Both cause confusing failures if skipped.

1. **Firebase → Authentication → Settings → Authorised domains** → add your
   Vercel domain. Until you do, sign-in fails with `auth/unauthorized-domain`
   and nothing else works.
2. **Google Cloud → Credentials → your Maps key → Website restrictions** → add
   `https://your-app.vercel.app/*`. If the key is currently unrestricted, this
   is also the moment to lock it down.

---

## Notes on the Hobby plan

- The daily quote follow-up cron in `vercel.json` runs once a day, which is
  exactly what Hobby allows. Nothing to change.
- Preview deployments are public by default. This app is full of customers'
  names and addresses, so turn on **Settings → Deployment Protection → Vercel
  Authentication** for Preview.

---

## Sharing it with the crew

Open the URL in **Safari** on the iPhone, then **Share → Add to Home Screen**.
The app prompts and walks through it the first time. Installed, it runs full
screen and reopens far faster between houses than a browser tab.

Accounts are still created by hand in the Firebase console — there is no
sign-up screen. See the README, step 3.
