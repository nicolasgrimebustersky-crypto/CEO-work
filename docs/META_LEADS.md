# Hooking up Meta Lead Ads

When someone submits an Instant Form on one of your Facebook or Instagram ads,
they land in the pipeline at **New lead**, both phones get a notification, and
they get an automatic text back. This is the setup for that.

You said you already have a Meta Business app and lead forms running, so this
is mostly "find these four values and paste them in".

---

## What I need from you

Four values, into `.env.local` locally and into Vercel's environment variables
for production. None of them are prefixed `NEXT_PUBLIC_` — they are read only
by the server.

| Variable | Where to find it |
|---|---|
| `META_APP_SECRET` | developers.facebook.com → your app → **Settings → Basic** → App Secret → **Show** |
| `META_VERIFY_TOKEN` | You invent this one. Any random string; it just has to match on both sides. `openssl rand -hex 16` |
| `META_PAGE_ACCESS_TOKEN` | See below — this is the fiddly one |
| `META_PAGE_ID` | Your Facebook Page → **About** → Page ID (optional, used only to reject leads from a Page that isn't yours) |

### Getting a Page Access Token that doesn't expire

This is the step that trips everyone up. A token from the Graph API Explorer
lasts an hour; you need a **long-lived Page token**, which does not expire.

1. **Add the permissions.** In your app → **App Review → Permissions and
   Features**, request `leads_retrieval`, `pages_show_list`, and
   `pages_manage_metadata`. For a Page you own, Advanced Access is usually
   granted immediately.
2. **Graph API Explorer** (developers.facebook.com/tools/explorer):
   - Pick your app from the dropdown.
   - **User or Page** → **Get User Access Token**, tick those three permissions.
   - Generate. Copy the token — call it `SHORT_USER_TOKEN`.
3. **Exchange it for a long-lived user token:**
   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id=YOUR_APP_ID
     &client_secret=YOUR_APP_SECRET
     &fb_exchange_token=SHORT_USER_TOKEN
   ```
4. **Swap that for a Page token**, which inherits the long life:
   ```
   GET https://graph.facebook.com/v21.0/me/accounts
     ?access_token=LONG_LIVED_USER_TOKEN
   ```
   Find your Page in the response and copy its `access_token`. **That** is
   `META_PAGE_ACCESS_TOKEN`.
5. **Check it:**
   ```
   GET https://graph.facebook.com/v21.0/debug_token
     ?input_token=PAGE_TOKEN&access_token=PAGE_TOKEN
   ```
   `expires_at` should be `0`. If it is a real date, you skipped step 3.

---

## Point Meta at the webhook

1. Deploy so `https://your-app.vercel.app/api/meta/leads` is live. **Meta will
   not accept a localhost URL** — for local testing use `ngrok` or just point it
   at a Vercel preview.
2. In your app → **Webhooks** → **Page** → **Subscribe to this object**:
   - Callback URL: `https://your-app.vercel.app/api/meta/leads`
   - Verify token: whatever you put in `META_VERIFY_TOKEN`
   - Click **Verify and Save**. The route answers the handshake automatically.
3. Still on Webhooks, subscribe to the **`leadgen`** field specifically.
   Subscribing to the Page object alone delivers nothing.
4. Subscribe your Page to the app:
   ```
   POST https://graph.facebook.com/v21.0/YOUR_PAGE_ID/subscribed_apps
     ?subscribed_fields=leadgen
     &access_token=PAGE_ACCESS_TOKEN
   ```
   This step is easy to miss and is the usual reason a correctly configured
   webhook receives nothing.

### Test it before trusting it

Meta's **Lead Ads Testing Tool**
(developers.facebook.com/tools/lead-ads-testing) submits a fake lead against a
real form. Use it, then check the pipeline board — the lead should appear in
**New lead** within a second or two, tagged *Facebook / Instagram*.

---

## What happens when a lead arrives

1. Meta POSTs a `leadgen_id` — **not** the answers.
2. The route verifies `X-Hub-Signature-256` against your app secret. Anything
   unsigned or wrongly signed is rejected with a 403. This matters more than
   usual here: a forged lead triggers an automatic SMS, so an unverified
   endpoint would be a way to make your Twilio account text arbitrary numbers.
3. It checks whether that `leadgen_id` already exists. Meta redelivers webhooks
   it thinks failed, so without this you would get duplicate leads and duplicate
   texts.
4. It fetches the answers from the Graph API and maps them onto a customer.
5. The lead is created at **New lead**, `source: meta_lead_ad`, tagged
   `facebook`.
6. Both crew get an in-app notification.
7. If a phone number came through, an acknowledgement text goes out.

### Field mapping

Standard form fields map automatically: `first_name`, `last_name`, `full_name`,
`phone_number`, `email`, `street_address`, `city`, `state`, `zip_code`.

**Anything else you asked on the form is preserved** — custom questions like
"which service do you need" are written to the lead's timeline verbatim rather
than dropped. Field names depend on how you built the form, so nothing is
guessed at.

### No map pin until there's an address

Instant Forms rarely collect a street address, so most Meta leads arrive
without one. They land in the pipeline and the customer list, but **not on the
map**, and the pipeline card says *No address yet*. A pin dropped at a guessed
location is worse than no pin — you would drive to the wrong house. Add an
address on the customer record and it appears on the map.

---

## The automatic text

Each new lead with a phone number gets:

> Hi [name], thanks for your enquiry with Grime Busters. We've got your details
> and one of us will call you shortly to talk it through. Reply STOP to opt out.

Sent through the same Twilio number as everything else and logged to the lead's
timeline under *Automatic reply*.

**One thing to sort out before you rely on this.** This is automated
first-contact SMS to a number that opted in through an ad form. Your **A2P 10DLC
campaign registration has to cover it** — if your campaign is registered as
"customer care" only, carriers will filter these as marketing and they will
silently fail to deliver. Check with Twilio that your campaign use case includes
lead follow-up, and keep the STOP line in the message; it is what stops the
whole number getting flagged.

To change the wording, edit `acknowledge()` in
`app/api/meta/leads/route.ts`. To turn it off entirely, delete that call —
the notification to both phones is separate and will still fire.

---

## If leads aren't arriving

| Symptom | Cause |
|---|---|
| "Verify and Save" fails | `META_VERIFY_TOKEN` doesn't match, or you haven't deployed yet |
| Handshake works, no leads ever | You subscribed the Page object but not the `leadgen` **field**, or skipped the `subscribed_apps` call |
| 403 in the Vercel logs | `META_APP_SECRET` is wrong or has whitespace around it |
| "Graph API returned 190" | Token expired — you used a short-lived one; redo the exchange |
| Lead appears, no text | Twilio not configured, no phone on the form, or A2P filtering |
| Duplicate leads | Shouldn't happen; the `sourceLeadId` check dedupes. If it does, check the index on that field |

Vercel's function logs for `/api/meta/leads` show the outcome of every delivery
(`created`, `duplicate`, or `error`).
