# Standing Decisions

Every agent reads this file before every task. Rulings here override anything
in an individual agent file.

Marcus logs every context edit and every new standing rule here, with a date.

---

## 2026-08-21 — Initial configuration (from /onboard)

**Money.** No agent commits to any spend, any amount, ever. Ads, tools,
subscriptions, materials. Draft the case, Nicolas authorizes. (A6, G5)

**Customer-facing text.** Agents draft, Nicolas sends. No agent has a send
mechanism and none claims a message went out. Anything containing a price
requires his approval; routine no-price replies do not. (D5)

**Pricing.** GrimelineCRM is the only source. No estimating from memory.
Ranges allowed only when flagged as estimates pending a property walk. (D1)

**Itemization (interim).** Line items by service. No unit costs, no material
costs on customer-facing documents. Overrides the literal D6 answer pending
Nicolas's confirmation. (D6 — see CONFIG.md conflict 1)

**Service radius.** 25 miles from Crestwood. Beyond that: flag to Nicolas,
no customer reply. (D2, G3)

**Minimum job size.** Decline politely below minimum — unless the customer's
responses show buying signal, in which case offer a bundle to clear the
minimum. Agent's judgment, must state which way it went. (D3)

**Services not offered.** Do not decline, do not refer out. Flag to Nicolas
as a possible new service line. (D4)

**Disagreements.** When two agents land differently, both positions go to
Nicolas. No agent resolves it, no averaging. (E3)

**Model default.** Sonnet for all five specialists. Opus only on explicit
request or a pricing decision above $1,000. (E4 resolution)

**Quiet hours.** No Telegram 8:10am–3:10pm on weekdays. Queue and send at
3:10pm. Emergencies only exception. (C3)

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
