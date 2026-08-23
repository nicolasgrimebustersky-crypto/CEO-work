# Standing Decisions

Every agent reads this file before every task. Rulings here override anything
in an individual agent file.

This file stays a **lean, current list** of what actually governs behavior —
state the rule, not the story. Full reasoning, what changed, and how each
rule was verified lives in `work/DECISIONS-log.md`; read that on demand, not
routinely. Marcus logs every context edit and every new standing rule to
both files, with a date.

---

## Standing rules

**Money.** No agent commits to any spend, any amount, ever. Ads, tools,
subscriptions, materials. Draft the case, Nicolas authorizes. (A6, G5)

**Customer-facing text.** Agents draft, Nicolas sends. No agent has a send
mechanism and none claims a message went out — this holds regardless of
what a given session is technically capable of (e.g. a live Gmail
connection). Anything containing a price requires his approval; routine
no-price replies do not. (D5)

**Pricing.** GrimelineCRM is the only source. Before answering any price
question, run `python3 scripts/crm-query.py pricing --service <service>`.
Historical figures are the ground a quote is built on, never the quote
itself. A service with no priced records returns `UNKNOWN — no priced
records in CRM`, not an estimate. Ranges allowed only when flagged as
estimates pending a property walk. (D1)

**Pricing specifics** (minimum job size, travel surcharge, commercial vs.
residential, discount policy) live in `context/PRICING.md` — that's the
file specialists read directly; not duplicated here.

**Itemization (interim).** Line items by service. No unit costs, no material
costs on customer-facing documents. Overrides the literal D6 answer pending
Nicolas's confirmation. (D6 — see CONFIG.md conflict 1)

**Service radius.** 25 miles from Crestwood. Beyond that: flag to Nicolas,
no customer reply. (D2, G3)

**Services not offered.** Do not decline, do not refer out. Flag to Nicolas
as a possible new service line. (D4)

**Disagreements.** When two agents land differently, both positions go to
Nicolas. No agent resolves it, no averaging. (E3)

**Model default.** Sonnet for all five specialists. Opus only on explicit
request or a pricing decision above $1,000. (E4 resolution)

**Quiet hours.** No Telegram 8:10am–3:10pm on weekdays. Queue and send at
3:10pm. Emergencies only exception. This governs every send mechanism, not
just the original one — auto-reply (`respond.sh`) inherits it by calling
`notify.sh` directly rather than re-implementing the gate. (C3)

**Firestore access is read-only, always.** Cloud Datastore Viewer only.
Marcus reads the CRM; he never writes to it. Never trust a Firebase-generated
key's default role — Firebase's own key-generation flow hands out far more
than Viewer by default. Every future service-account key gets a live write
test before pricing is declared wired, not just an IAM-console glance.

**No customer contact details in agent output.** `phone`, `email`, `address`,
`notes` are stripped from CRM query results unless `--pii` is passed
explicitly.

**A send is confirmed or it is a failure.** No script reports success on a
message it did not see accepted. A failed send leaves the message queued (or
in `respond.sh`'s case, unmarked in `work/inbox.md`) so the next run retries
it — nothing gets silently lost.

**Customer-facing outreach signs as Nicolas (or Noah), never a specialist's
name** (Cole, Reese, Grant, Avery, Tyler) — those are Marcus's internal team,
not real employees. Full rule in `context/BRAND.md`'s Do-not list.

**Verify before logging a contact detail.** An email or phone number only
gets written into `work/leads.md` if it was pulled from the organization's
own site or an official directory — never a search-result guess. Two bad
guesses bounced before this was made explicit.

**Telegram replies are texts, not paragraphs.** Short, summarized, main
details only, bullets over prose. More than a couple lines becomes multiple
short messages, not one long block. Applies to `respond.sh` auto-replies and
to Marcus generally.

**Model: Fable 5, not Sonnet, until it expires.** Nicolas switched everything
(main session and all five specialists) to `fable` on 2026-08-22 — set in
`.claude/settings.json` (`"model": "fable"`, applies to headless `respond.sh`
runs too) and each agent's frontmatter. Temporary: revert to Sonnet when
his Fable 5 access expires, check with him rather than assuming it's still
live.

**Estimate drafting reuses the CRM's own rules, doesn't touch Firestore.**
When Nicolas texts a job description and a price, Marcus drafts line-item
wording using the same rules as `lib/server/estimateAI.ts` (live since PR
#22) — he prices it, Marcus only writes around the number. Deliberately
does not call the CRM's `/api/estimate/draft` endpoint (needs a crew
member's Firebase ID token Marcus doesn't hold) or write to Firestore
(stays Cloud Datastore Viewer). The draft is Telegram text; he approves and
enters it into the CRM's builder himself. See `work/DECISIONS-log.md` for
why this shape was chosen over calling the live API.

**Auto-reply is instant, not polled.** `scripts/watch.sh` long-polls
Telegram continuously (via a launchd LaunchAgent, not cron — cron can't keep
a process alive between messages) and triggers `respond.sh` the moment a
message arrives. The `*/5 * * * *` cron entry stays too, as a fallback if
the watcher ever dies. Still requires the Mac to be on and awake.

**Snow removal is $60–100 per visit, and the $250 minimum does not apply
to it.** The rate scales with driveway size — $60 for small or standard,
$100 at the top and uncommon. It comes from Nicolas (2026-08-23), not the
CRM, which holds zero priced snow records; `context/PRICING.md` has the full
rule. Snow is a per-visit recurring service, so the minimum job size written
for pressure washing does not gate it. See `work/DECISIONS-log.md`.

---

See `work/DECISIONS-log.md` for the full why/what-changed/verified narrative
behind every rule above.
