# Shipping Grime Busters CRM on iOS

Everything the repo can do is done. This is the part that needs a Mac, an Apple
Developer account, and decisions only you can make.

---

## Read this first: the App Store is probably the wrong channel

This is a private tool for two people. It has no public audience, and Apple's
**Guideline 4.2 (Minimum Functionality)** exists to keep exactly this kind of
app off the store: *"your app should include features, content and UI that
elevate it beyond a repackaged website."*

We have a real case to make — background location, camera capture, offline data,
push — and the build is a native bundle rather than a webview pointed at a URL.
But you would be spending review cycles arguing for a listing that nobody will
ever search for.

**Three ways to get this on two iPhones**, cheapest first:

| Route | Cost | Review | Good for |
|---|---|---|---|
| **Ad Hoc** | $99/yr Developer Program | **None** | Up to 100 registered devices. Install by link or Apple Configurator. Rebuild yearly when the cert expires. |
| **TestFlight (internal)** | Same $99/yr | Light, usually hours | Up to 100 internal testers, over-the-air updates. Builds expire after 90 days. |
| **App Store** | Same $99/yr | Full review, days to weeks, 4.2 risk | A listing you do not need. |

**Recommendation: TestFlight internal testing.** You get over-the-air updates
without App Review gatekeeping every change, and the 90-day expiry is a
non-issue for an app you are actively working on. Everything in this document
still applies except the store listing itself — Ad Hoc and TestFlight use the
same build, the same entitlements, and the same Info.plist.

If you want the App Store anyway, keep reading; nothing below is wasted.

---

## What the repo already handles

| Requirement | Where |
|---|---|
| Native bundle, not a webview on a URL | `capacitor.config.ts` — no `server.url` |
| Static export that runs offline | `BUILD_TARGET=native`, `npm run ios:build` |
| Permission purpose strings | `ios-template/Info.plist` |
| Background location declared and justified | `UIBackgroundModes` + the "always" usage string |
| User-facing location switch (5.1.1) | Account screen → Location sharing |
| In-app account deletion (5.1.1v) | Account screen → Delete my account |
| Public privacy policy | `/privacy`, reachable signed-out |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` |
| No arbitrary ATS loads | `NSAppTransportSecurity` |
| Portrait-only, dark UI | `UISupportedInterfaceOrientations`, `UIUserInterfaceStyle` |
| Icon without alpha | `assets/icon.png`, RGB, 1024×1024 |
| Credentials kept out of the binary | API routes excluded via `pageExtensions` |

---

## Build steps (on a Mac)

```bash
# 1. Point the app at your deployed backend. The native bundle has no API
#    routes of its own.
echo 'NEXT_PUBLIC_API_BASE_URL=https://your-app.vercel.app' >> .env.local

# 2. Build the static bundle and create the iOS project.
npm run ios:build          # fails fast if the API base URL is missing
npx cap add ios            # first time only

# 3. Apply the privacy keys. The generated Info.plist has none of them.
#    Copy the marked blocks from ios-template/Info.plist into
#    ios/App/App/Info.plist, or replace the file wholesale.

# 4. Icons and splash.
npx capacitor-assets generate --ios

# 5. Open Xcode.
npm run ios:open
```

In Xcode, once:

- **Signing & Capabilities** → your team, bundle id `com.grimebustersky.crm`.
- **+ Capability → Background Modes** → tick **Location updates** and
  **Remote notifications**. (The Info.plist keys declare intent; the capability
  is what actually enables them.)
- **+ Capability → Push Notifications** if you wire push up.
- Deployment target **iOS 14.0** or later.

Every time the web code changes: `npm run ios:build` then rebuild in Xcode.

---

## The two things most likely to get you rejected

### 1. Background location (Guideline 2.5.4 / 5.1.1)

This is the highest-risk part of the app. Reviewers reject background location
that is not obviously necessary, and "so my business partner can see me" needs
to be stated in the reviewer notes, not left for them to infer.

Put this in **App Review Information → Notes**:

> This app is used by the two owners of a small door-to-door services business
> in Oldham County, Kentucky. Both users are account holders who consent to
> sharing their position with each other.
>
> Background location is required because the two owners split a street and
> knock opposite sides. Each needs to see the other's current position to avoid
> knocking a door their partner already covered. The phone is in a pocket
> between houses, so foreground-only location freezes the other person's map
> and defeats the feature.
>
> Location is not stored historically — only each user's most recent position is
> kept, and it is overwritten continuously. No third party receives it. Either
> user can stop sharing instantly from the Account screen, which stops both the
> collection and the sharing.
>
> Demo account: [EMAIL] / [PASSWORD]

### 2. Guideline 4.2, "this is a website"

Have an answer ready. The honest one:

> The app is a native bundle, not a hosted page — it works with no connection,
> using cached customer records and queued writes that sync on reconnect. It
> uses background location updates, the camera for job documentation, and push
> notifications. None of these are available to the web version.

If they reject under 4.2 anyway, that is the signal to move to TestFlight and
stop spending time on it.

---

## App Store Connect: what to enter

### App Privacy ("nutrition label")

Answer **Yes** to data collection, then:

| Data type | Collected | Linked to identity | Used for tracking | Purpose |
|---|---|---|---|---|
| Precise Location | Yes | Yes | **No** | App Functionality |
| Contact Info — Name | Yes | Yes | No | App Functionality |
| Contact Info — Email | Yes | Yes | No | App Functionality |
| Contact Info — Phone | Yes | Yes | No | App Functionality |
| Contact Info — Physical Address | Yes | Yes | No | App Functionality |
| User Content — Photos | Yes | Yes | No | App Functionality |
| User Content — Other (notes) | Yes | Yes | No | App Functionality |
| Identifiers — User ID | Yes | Yes | No | App Functionality |

**Tracking is No across the board.** There is no advertising, no analytics SDK,
and nothing is shared with data brokers — so no App Tracking Transparency
prompt is required. Do not answer Yes here "to be safe": it would oblige you to
show an ATT prompt the app does not have, which is itself a rejection.

Note that customer contact details are collected *about third parties*, not
about the user. Apple's form has no way to express that, so declare it as
collected and explain it in the reviewer notes.

### Other fields

- **Privacy Policy URL**: `https://your-app.vercel.app/privacy`
- **Category**: Business
- **Age rating**: 4+
- **Price**: Free
- **Availability**: United States only
- **Content rights**: you own or have licensed all content
- **Export compliance**: uses encryption → **exempt** (standard HTTPS only)

### Screenshots

Required: **6.7"** (1290×2796) and **6.5"** (1242×2688), portrait, at least 3
each. Use the map, the day schedule, and a customer record. Take them on a real
device with real-looking data — placeholder text is a Guideline 2.3.3 rejection.

---

## Before you submit

- [ ] Fill in every `[BRACKETED]` value in `app/privacy/page.tsx` — a policy
      with placeholders is an automatic 5.1.1 rejection
- [ ] Set `NEXT_PUBLIC_API_BASE_URL` and confirm sending a text works on device
- [ ] Add `capacitor://localhost` to the Firebase **Authorised domains** list,
      or sign-in fails in the app with `auth/unauthorized-domain`
- [ ] Restrict the Google Maps key to the iOS bundle id as well as your web
      domains
- [ ] Create a demo account for the reviewer and put the credentials in App
      Review Information — an app that opens on a login wall with no way in is
      rejected under 2.1 within hours
- [ ] Test with location permission **denied** — the app must stay usable
- [ ] Test in airplane mode — cached data should render, writes should queue
- [ ] Confirm account deletion works end to end on device
- [ ] Confirm the privacy policy loads signed out, in the app and in Safari

---

## Known gaps

- **Push notifications are wired but not delivered.** The plugin and capability
  are in place; nothing sends a push yet. In-app notifications work today. If
  you want real pushes, add a Firebase Cloud Function that fires on job writes
  and register the APNs key in the Firebase console — until then, do not tick
  the Push Notifications capability, because a declared-but-unused capability
  draws questions.
- **The map needs a connection.** Google's terms forbid caching tiles, so the
  map is blank offline while everything else keeps working. Say so if asked.
- **No iPad build.** The layout is portrait phone only. Leave "iPad" unchecked
  in the target's deployment info, or Apple will review it on an iPad and
  reject the layout.
