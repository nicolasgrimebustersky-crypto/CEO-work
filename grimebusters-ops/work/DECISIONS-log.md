# Decisions Log — full history

The complete why/what-changed/verified narrative behind every standing rule
in `work/DECISIONS.md`, in order. Not read by default before a response —
`DECISIONS.md` itself is the lean, current list that governs behavior. Read
this file when you need the reasoning or the paper trail behind a rule, not
routinely.

---

## 2026-08-21 — Initial configuration (from /onboard)

Configured from the onboarding interview. Every rule from this entry is
still current — see `work/DECISIONS.md`'s "Standing rules" section rather
than duplicating them here.

---

## 2026-08-21 — Firestore wired to GrimelineCRM

**Why.** CONFIG.md conflict 4 was the blocker under everything else: pricing
was declared CRM-only, and there was no CRM connection, so every price
question returned UNKNOWN. The setup notes guessed at collection names
(`invoices`, `lineItems`) that do not exist.

**Changed.**
- `scripts/crm-query.py` rewritten against the real schema in `lib/types.ts`.
  Three modes: `pricing`, `list`, `doc`.
- `scripts/README-firestore.md` — the actual collection and field map, not a
  list of likely candidates.
- `context/PRICING.md` — the UNKNOWN-blocker section replaced with the query
  to run.
- `context/CONFIG.md` — conflict 4 marked resolved.

**Standing rules this adds.**

*Pricing lookups.* Before answering any price question, run
`python3 scripts/crm-query.py pricing --service <service>`. Historical
figures are the ground a quote is built on, never the quote itself. Hard rule
3 is unchanged: anything with a price in it goes to Nicolas first.

*UNKNOWN survives.* A service with no priced records still returns
`UNKNOWN — no priced records in CRM`. Wiring the CRM removed the excuse for
UNKNOWN, not the answer. Snow removal history is thin.

*Read-only, always.* The service account is Cloud Datastore Viewer. Marcus
reads the CRM; he never writes to it. The CRM is the live book of customers
and money for a running business.

*No customer contact details in agent output.* `phone`, `email`, `address`
and `notes` are stripped from query results unless `--pii` is passed
explicitly. Query output lands in agent context windows and Telegram
messages; customer phone numbers belong in neither.

**Still on Nicolas.** Generate the read-only key. Until then the script exits
with instructions and pricing answers stay UNKNOWN.

---

## 2026-08-21 — Telegram scripts: delivery is now verified, not assumed

**Why.** `notify.sh` printed `sent` whenever `curl` exited cleanly. curl exits
0 on an HTTP 401 or 400, so a wrong token, a wrong chat id, or a message
Telegram refused to parse all reported success while nothing arrived. Tested
against a stand-in API: two messages reported `sent`, neither was delivered.

That is hard rule 4 — never claim a message went out — broken by the one
script that does the sending.

**The parse failure was not hypothetical.** `parse_mode=Markdown` with an odd
number of underscores returns 400. Every service name carries one:
`pressure_washing`, `snow_removal`. Any notification quoting a service — which
is most of them, and all the price ones — would have vanished silently.

**Changed.**
- `notify.sh` — checks the API actually returned `"ok":true`, exits non-zero
  and prints Telegram's reason otherwise. On a Markdown parse error it retries
  once as plain text rather than dropping the message. Refuses to run with a
  missing or empty `.env` instead of sending to `bot/sendMessage`.
- `flush-queue.sh` — claims the queue by moving it aside, and restores it if
  the send fails. It used to truncate unconditionally, so a failed flush threw
  away every message queued during the school day.
- `weekly-review.sh` — had no failure check at all; a `claude` error was texted
  out as though it were the review.
- `daily-report.sh` — pointed at `/tmp/gb-report.log`, which nothing writes.
  Now uses `$GB_LOG` (default `/tmp/gb.log`, matching the crontab in README).
- Both report scripts check `claude` is on PATH first. Cron's PATH is minimal
  and this is the most likely way they fail in practice.
- `check-replies.sh` — guards a missing `.env` and a corrupted `.tg_offset`.

**Standing rule this adds.**

*A send is confirmed or it is a failure.* No script reports success on a
message it did not see accepted. If a notification cannot be delivered, the
queue keeps it and the run exits non-zero so cron surfaces it.

**Not changed.** Quiet hours were already correct — 8:10am and 3:10pm
boundaries, weekdays only, verified across nine cases including both edges.

**Testing.** All of the above was exercised against a local stand-in for the
Telegram API. `TELEGRAM_API_BASE` now overrides the endpoint, which is what
made that possible; it defaults to the real one.

---

## 2026-08-21 — `.env` Telegram credentials fixed

**Why.** `notify.sh` failed outright: `getMe` returned 404. `TELEGRAM_TOKEN`
was missing its bot-ID prefix — only the auth-string half
(`AAGYKgCTD...`) was set, with no numeric ID and no colon in front of it.

**Changed (local `.env`, not tracked in git).**
- `TELEGRAM_TOKEN` — completed with the bot ID from BotFather:
  `8834247309:AAGYKgCTD...`. `getMe` now returns 200 (`@grimebusterskyBOT`).
- `TELEGRAM_CHAT_ID` — was set to `8834247309`, the bot's own ID, so
  `sendMessage` came back `403 Forbidden: the bot can't send messages to the
  bot`. Replaced with Nicolas's real private chat ID (`7346898248`), pulled
  from `getUpdates` after he messaged the bot directly.

**Verified.** `FORCE=1 ./scripts/notify.sh "Marcus online."` delivered
successfully.

---

## 2026-08-22 — Firestore key installed; Marcus fully installed

**Why.** CONFIG.md conflict 4's last step — generate the read-only
service-account key — was still on Nicolas. Without it every pricing answer
was `UNKNOWN` regardless of the query wiring from the prior session.

**Changed.**
- `firebase-readonly.json` dropped in at the repo root (gitignored, verified
  with `git check-ignore` before use). Project: `grimeline-5e3d8`.
- `.env` — `FIREBASE_PROJECT_ID=grimeline-5e3d8` filled in.
- `pip install firebase-admin` run.
- Crontab installed: daily report (7am), quiet-hours queue flush (3:10pm
  weekdays), weekly review (Friday 3:30pm), reply-check (every 30min) — all
  four from the README, with an explicit `PATH` line since `claude` lives
  under nvm and cron's default PATH doesn't see it.

**The permission problem.** Firebase's default-generated key for this service
account (`firebase-adminsdk-fbsvc@grimeline-5e3d8...`) was not just Editor —
it carried **Firebase Admin SDK Administrator Service Agent** (near-full
Firebase access, including Firestore writes), **Storage Admin** (full access
to job photos in Cloud Storage), and **Service Account Token Creator**
(lets this key mint tokens to impersonate other service accounts — the most
dangerous of the three if the key ever leaks). Cloud Datastore Viewer being
present didn't help while the broader roles were still granted alongside it.

**Verified, not assumed.** After Nicolas removed the three extra roles in
IAM, a live write attempt against the CRM still succeeded — IAM propagation
lag, not a failed removal. Confirmed by rechecking the console (only
`Cloud Datastore Viewer` listed) and retesting: a write to a throwaway test
document (`_marcus_permission_test/probe`) then returned
`403 PermissionDenied`, and a read (`pricing --service pressure_washing`)
still returned real figures. Both test writes were deleted immediately after
each attempt — nothing left behind in the CRM.

**Standing rule this adds.**

*Never trust a Firebase-generated key's default role.* Firebase's own
"Generate new private key" flow does not hand out Cloud Datastore Viewer by
default — it hands out project Editor plus several Firebase-specific admin
roles. Every future service-account key for this project gets a live write
test before Marcus is told pricing is wired, not just an IAM-console glance.

**Confirmed live.** `python3 scripts/crm-query.py list jobs --limit 1` and
`pricing --service pressure_washing` both returned real GrimelineCRM data.
Marcus is fully installed: Telegram verified, Firestore read-only and
write-blocked, cron scheduled.

---

## 2026-08-22 — Specialist agent audit; PRICING.md gaps filled

**Why.** Nicolas asked for the same treatment the CRM wiring got: check the
five specialist files (`grant.md`, `cole.md`, `reese.md`, `avery.md`,
`tyler.md`) against actual repo state rather than assuming they're current.

**Checked.** Every `work/*.md` and `context/*.md` file each agent claims to
read or write — all exist, all match the writer/reader pairing described
(e.g. Grant writes `work/site-changes.md`, Reese reads it before promoting a
page — headers match on both ends). No phantom scripts, no stale competitor
lists, no broken cross-references.

**Found two real gaps, both Nicolas's numbers, not bugs:**
- `context/PRICING.md` had four unfilled TODOs Cole and Reese's own rules
  depend on (minimum job size, travel surcharge, commercial/residential
  split, discount structure).
- `context/ASSETS.md` — job library still not indexed. Tyler's "never invent
  a job" rule means he's blocked on content until this has real entries.
  Still open; Nicolas didn't provide this round.

**Changed.**
- `context/PRICING.md` — TODO checklist replaced with confirmed rules:
  minimum job size $250; travel surcharge 15+ miles, $50-100, Nicolas's call
  per job; commercial trends higher than residential with no fixed
  multiplier; no discounts ever without Nicolas's explicit sign-off on that
  specific instance.
- `.claude/agents/cole.md` — dropped the stale "or the key isn't in place
  yet" clause now that Firestore is live; UNKNOWN still handled the same way
  if a service genuinely has no priced records.

**Not changed.** `reese.md` wasn't touched — she already reads
`context/PRICING.md` before every task, so the new no-discount rule reaches
her without duplicating it in her file and risking drift between the two.

---

## 2026-08-22 — `context/ASSETS.md` populated from real CRM job data

**Why.** Nicolas asked for the job list to fill in ASSETS.md, which the prior
audit flagged as blocking Tyler's content.

**What the CRM actually has.** Pulled all 11 `status=complete` jobs via
`crm-query.py list jobs`. Every one of them has an empty `beforePhotos` and
`afterPhotos` array — the CRM has never had media attached to a job. That's
a finding, not an assumption: the table Marcus built from real job data
(id, date, service, price, a notability read pulled from `jobNotes`) has real
values in every column except photos and video, which stay `TODO` because
there is no CRM field to pull them from.

**Changed.** `context/ASSETS.md` — replaced the empty TODO table with 10 real
job rows. Matched `fl-fb8e88a9` (Adam, driveway, sodium hypochlorite, same
week) against the pre-existing "Adam's concrete driveway" note as a likely
match, flagged for Nicolas to confirm rather than asserted as certain.
Flagged Broeck Pointe Cir as unmatched — no job in the pull references it by
name. Flagged the YWAM Mazatlán trip as a mission trip, not a paid job, so it
will never appear in a CRM pull regardless.

**Still open.** Photos and video for all 10 rows — that media lives outside
the CRM (Nicolas's phone, Google Photos, etc.), and nothing in this system
has access to it. Tyler stays blocked on visual content until those columns
are filled, though he can now reference real job specifics (service, price,
date, what made it notable) instead of nothing.

---

## 2026-08-22 — First real outreach sent as Gmail drafts; "Cole" signature bug fixed

**Why.** Nicolas approved Cole's 11-prospect commercial list and asked for
two of them (Grand Dell HOA, Kenwood Northeast Baptist Church — the only two
with an email address) to go out as email, with Kenwood Northeast updated to
reference a real completed job at New Life Church he described directly
(sidewalks, sign, curb). Marcus has a live Gmail connection in this session,
but hard rule 4 (draft, don't send) still applies — the fix was creating
**drafts** in Nicolas's Gmail for him to review and send, not sending
directly.

**Changed.**
- Two Gmail drafts created (`create_draft`, not `send_message`): Grand Dell
  HOA and Kenwood Northeast Baptist Church. Rewritten to lead with a real
  pain point (slip risk / home values; visitor first impression) rather than
  a bare "can I take a look," per Nicolas's ask to make prospects actually
  want the service.
- `context/ASSETS.md` — added New Life Church (pressure washing: sidewalks,
  sign, curb). Not in the CRM under any collection — checked jobs, quotes,
  customers, no match. Logged as Nicolas-reported, date/price unconfirmed.
- `work/leads.md` — status updated for the two emailed prospects, and a real
  bug fixed across **all 12** drafted opening lines: every one said "I'm Cole
  with Grime Busters KY." There is no employee named Cole — that's Marcus's
  internal specialist name, and BRAND.md's own voice samples sign
  customer-facing messages as Nicolas. Replaced throughout.
- `context/BRAND.md` — added an explicit "Do not" line: never sign
  customer-facing outreach with a specialist's name (Cole, Reese, Grant,
  Avery, Tyler). This was silent in BRAND.md before — implied by the voice
  samples, never stated as a rule — so it slipped through Cole's own draft
  without him catching it.

**Standing rule this adds.** *A live send capability does not relax hard
rule 4.* Marcus having Gmail (or any other) send access in a given session
does not change "you draft, he sends" — it only changes the mechanism from
"paste this into your email client" to "review this draft I already typed
in for you." The distinction that matters is whether Nicolas's own action is
what actually sends it, not whether Marcus is technically capable of
clicking send.

**Not changed.** The other 10 prospects stay as phone/in-person scripts in
`work/leads.md` — no email address on file for them, so nothing to draft in
Gmail. Nicolas calls or visits those himself.

---

## 2026-08-22 — `scripts/respond.sh`: real auto-reply, not just a queue

**Why.** Nicolas revised the "online 24/7" ask: he doesn't need Marcus
running background work on a server. He needs Marcus to actually answer
when texted, any time. The gap: `check-replies.sh` only ever pulled messages
into `work/inbox.md` as a queue — nothing read that queue and generated a
reply. A message sent at noon sat there until the next interactive session,
which could be hours or days away.

**Changed.** New `scripts/respond.sh`. Calls `check-replies.sh` to pull new
messages, bundles unanswered inbox lines into one `claude -p` call, sends
the reply through `notify.sh` unmodified so the existing quiet-hours gate
governs auto-replies too — Nicolas's explicit call, keep quiet hours for
this. Crontab tightened from `*/30 * * * *` check-replies.sh to
`*/5 * * * *` respond.sh (which calls check-replies.sh internally).

**Three real bugs found and fixed on first live run, in two rounds:**
1. inbox.md was marked `[replied]` unconditionally after any send attempt,
   including failed ones — a failed send would have stamped the message
   answered and lost it permanently. Fixed: marking only happens on a
   confirmed successful (or quiet-hours-queued) send.
2. Every unmarked line got stamped, not just the lines actually in that
   run's prompt — a message landing mid-`claude -p` call could get marked
   answered without ever being read. Fixed: only the exact lines passed to
   the prompt get marked.
3. The retry those two fixes depend on couldn't happen — the script exited
   early unless the Telegram poll itself returned something new, so a
   failed send's message would be stranded until an unrelated new message
   arrived. Fixed: the gate is "is anything unanswered in inbox.md," not
   "did this specific poll bring something new."
4. A separate regex bug (caught after the above): the unmarked-line filter
   only excluded `[replied` lines, not `[handled` — entries manually tagged
   before this script existed would get swept into a prompt and re-tagged.
   Fixed by excluding both tag words.

Round 1 (bugs 1-3 minus the regex fix) came from an automated review that
caught defects `claude -p` calls in production are exactly the kind of
place they matter — a cron job that runs unattended and sends autonomously
does not get a human noticing something looked off. Verified against a
stand-in Telegram API: happy path delivers and marks; a repeat run is a
no-op; a failed send exits non-zero and leaves the message unmarked; the
next run answers it with no new message arriving; claude off PATH warns
without marking; a check-replies failure attempts no reply.

**Standing rule this adds.** *A live send/reach capability does not relax
hard rule 4 or the quiet-hours gate, whatever the mechanism.* Same principle
as the Gmail-drafts entry above, applied twice more: once to auto-reply
send confirmation (never mark something answered that wasn't actually
delivered), once to quiet hours (auto-reply inherits `notify.sh`'s gate by
construction, not a re-implementation that could drift).

---

## 2026-08-22 — DECISIONS.md split into lean rules + this archive

**Why.** Nicolas asked to make the auto-reply flow more efficient.
`work/DECISIONS.md` had grown to 358 lines and — because it's one of
CLAUDE.md's four mandatory pre-response reads — was getting re-read in full
on every single `respond.sh` invocation, most of which is historical
narrative (why something was done, what was verified) rather than an
active behavioral rule.

**Changed.** Split into this file (full history, read on demand) and a
rebuilt `work/DECISIONS.md` (current standing rules only, each pointing
here for the reasoning behind it). Also tightened `respond.sh`'s own prompt
wording — it said "read context/ and work/ as usual," broader than what
CLAUDE.md actually mandates (`context/CONFIG.md`, `BRAND.md`, `PRICING.md`,
`work/DECISIONS.md`), so it was pulling in files like `work/leads.md`
unconditionally on every reply regardless of whether the message needed
them.

**Standing rule this adds.** *New DECISIONS.md entries stay lean by
default.* State the rule and a one-line pointer to this log for the why;
don't duplicate the full why/changed/verified narrative in the file that
gets read on every response.

---

## 2026-08-22 — Estimate drafting via Telegram, without touching Firestore

**Why.** Nicolas wants to describe a job and a price to Marcus on the go
and get a draft estimate back to approve — "for more on-the-go quickness."

**What already existed.** The CRM (`grimebusters-crm`, PR #22, merged
before this session started) already has exactly this feature:
`POST /api/estimate/draft`, backed by `lib/server/estimateAI.ts`. It takes
a spoken description, a total the operator already decided, and up to four
photos, and returns line-item wording via Claude Opus 5 — the model is
explicitly told never to see or mention a price, only to write around one
the human supplied. That division (human prices, model words) is the whole
point of the existing design, and it's the same principle CLAUDE.md already
enforces for every other pricing interaction in this system.

**Why Marcus doesn't call that endpoint directly.** It requires
`Authorization: Bearer <firebase id token>` for an allowlisted crew UID
(`requireCrew` in `lib/server/auth.ts`). Marcus's only CRM credential is the
read-only service-account key, deliberately locked to Cloud Datastore
Viewer after the IAM cleanup earlier this session — it cannot mint a user
auth token, and getting Marcus a real one would mean either sharing a
short-lived personal token repeatedly (impractical, token expires in about
an hour) or granting a broader credential (reopens exactly the "no write
access" boundary that got real IAM cleanup work earlier today).

**The design chosen instead.** Marcus drafts the same shape of output
using the same rules, inline, in his own response — no API call, no new
credential, no Firestore write. `CLAUDE.md` now carries the rules verbatim
(adapted from `estimateAI.ts`'s system prompt): plain language, one line
per distinct piece of work, never invent a service, never state a rate or
show the math, and above all — Nicolas gives the price, Marcus never does.

**What happens after the draft.** It's a Telegram text, not a persisted
object. Nicolas reviews it like any other draft (hard rules 3 and 4 are
unchanged — nothing reaches a customer until he says so, and Marcus still
has no send mechanism), and if he approves it, *he* enters it into the
CRM's actual estimate builder to create and send the real thing. This
keeps the read-only boundary intact and avoids building a second,
parallel estimate-creation path that could drift from the one the CRM app
already ships and tests.

**Not done.** No code in the CRM repo was touched — this is entirely a
Marcus-side (CLAUDE.md) change. If real usage shows this manual
copy-into-the-builder step is too much friction, the next step would be
giving Marcus a scoped way to call `/api/estimate/draft` itself (e.g. a
dedicated service credential distinct from the read-only Firestore key) —
that's a deliberate future decision, not something to slide into
unprompted.


## 2026-08-23 — Snow removal rate set from Nicolas; CRM linked from the remote session

**Why.** The remote session was given live read access to the CRM (a fresh
`claude-session-readonly` service account, Cloud Datastore Viewer only,
verified read-only by a real write attempt returning `403 Missing or
insufficient permissions`). The first pricing queries against production
showed snow removal with **zero priced records** — no completed jobs, no
accepted quotes — while `context/PRICING.md` named `snow_removal` as a
queryable service. Marcus would have answered every snow price question with
`UNKNOWN`, which is honest but useless in December.

Nicolas gave the real number directly: $60–100 per visit, "rarely 100."

**Changed.** `context/PRICING.md` gains a **Snow removal** section: $60–100
per visit scaling with driveway size, $60 for small or standard, $100 the
uncommon top. Stated explicitly as Nicolas's standard rate rather than a
historical median, with an instruction to prefer the CRM if it ever starts
carrying completed snow jobs. The "thin history" line above it was replaced,
since "thin" understated it — the history is empty.

Also resolved a conflict this exposed: the **$250 minimum job size** would
have made Marcus politely decline every snow job, since $60–100 is well
under it. Snow is now explicitly exempt — it is a per-visit recurring
service, not a one-off job, and the floor was written for pressure washing.
Both the snow section and the minimum-job-size bullet say so.

**Verified.** Live queries against production Firestore, this session:
pressure washing 6 completed jobs, median $315, range $200–1,095, quote win
rate 27%; landscaping 4 completed jobs, median $263, range $45–4,750; snow
removal 0 records on both bases. The write probe was denied before any of
these ran.

**Still open.** Landscaping's p75 is $3,681 against a $263 median across four
jobs — too few records, and too wide a spread, to price from. Anything
Marcus says about landscaping pricing is currently an extrapolation from
almost nothing. Worth either more history or a stated rate from Nicolas, the
same way snow was just handled.

**Standing rule this adds.** *Where the CRM is empty, a rate from Nicolas
beats `UNKNOWN`* — but it must be labeled as his standard rate, not dressed
up as a historical figure, and the CRM wins as soon as it has real records.


## 2026-08-23 — Marcus can create draft estimates, authenticated as crew

**Why.** Nicolas asked for Marcus to *create* an estimate rather than hand
back wording to retype: "I want him to be able to create and then I can send
it." The existing flow stopped at Telegram text on purpose, because Marcus's
CRM credential is Cloud Datastore Viewer.

**The decision that mattered.** Three ways to give Marcus write access were
put to him, and he chose crew authentication. The one that was rejected is
worth recording: **Firestore security rules do not apply to service
accounts.** Adding Cloud Datastore User to the existing key would have been
a two-minute change and would have bypassed every clause in
`firestore.rules` — `isCrew()`, the author stamps, the frozen invoice
numbers — giving unrestricted write to every collection, including `users`,
which is what decides who counts as crew. A read key and a write key are not
the same kind of object.

**Changed.** New `scripts/create-estimate.ts`. It signs in with
`signInWithEmailAndPassword` as a dedicated crew account, then writes one
document to `documents` with `status: "draft"`. Rules therefore apply to it
exactly as they apply to the app, and `stampedByCaller('createdBy')` means
the estimate carries a real author stamp rather than an anonymous
service-account write.

Two things are imported from the CRM's own `lib/documents.ts` rather than
reimplemented: `computeTotals` and `nextNumber`. A second copy of the tax
arithmetic would drift from the app's the first time either changed, and
then a draft Marcus created and one the app created would disagree about
what a customer owes. Node 22's `--experimental-strip-types` runs the
TypeScript directly, so there is no build step and no copy.

`status` is a hardcoded string, not an argument. There is no send path.

**Verified.** Six failure paths, run against the real script: missing
`.env`; missing `--customer-id`; a service type that isn't one of the three;
malformed `--line-items` JSON; a line item with a name but no `unitPrice`
(which would otherwise have become a silent $0 line); and valid arguments
with bad credentials, which reached a live Firebase Auth call and failed
there. Each named its own cause. `computeTotals` was checked directly: a
single $315 line at the default 6% returns `total: 333.9`.

**Not verified.** No estimate has actually been created. The crew account
does not exist yet, and the credential belongs in the `.env` on Nicolas's
Mac — not in a remote session's environment, and not in a transcript. First
real run should use `--dry-run`, which exercises sign-in, the customer read
and the number allocation, and prints the document without writing it.

**Standing rule this adds.** *Write access to the CRM goes through a crew
login, never a service-account key.* Rules are the boundary; a service
account is outside it.

