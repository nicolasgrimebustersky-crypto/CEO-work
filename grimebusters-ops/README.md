# Grime Busters Ops

Marcus (CEO Agent) + five specialists: Grant, Cole, Reese, Avery, Tyler.
Configured 2026-08-21 from `/onboard`.

## Setup — about 15 minutes

**1. Put this folder somewhere permanent and init git**
```bash
cd grimebusters-ops
git init && git add -A && git commit -m "initial system"
```

**2. Telegram bot**
- Telegram → `@BotFather` → `/newbot` → name it Marcus → copy the token
- Message your new bot anything
- Open `https://api.telegram.org/bot<TOKEN>/getUpdates` → find `"chat":{"id":...}`

**3. Environment**
```bash
cp .env.example .env
# fill in TELEGRAM_TOKEN and TELEGRAM_CHAT_ID
git check-ignore -v .env     # must print a match before you commit again
```

**4. Test**
```bash
FORCE=1 ./scripts/notify.sh "Marcus online."
```

**5. Firestore** — the query tool is already wired to the real GrimelineCRM
schema. The one thing left is the key: generate a read-only service account,
save it as `firebase-readonly.json` here, and verify:
```bash
pip install firebase-admin
python3 scripts/crm-query.py pricing --service pressure_washing
```
Full instructions and the collection map: `scripts/README-firestore.md`. Not
optional; all pricing lives in the CRM.

**6. Cron**
```bash
crontab -e
```
```
0  7 * * *   /FULL/PATH/grimebusters-ops/scripts/daily-report.sh   >> /tmp/gb.log 2>&1
10 15 * * 1-5 /FULL/PATH/grimebusters-ops/scripts/flush-queue.sh   >> /tmp/gb.log 2>&1
30 15 * * 5  /FULL/PATH/grimebusters-ops/scripts/weekly-review.sh  >> /tmp/gb.log 2>&1
*/30 * * * * /FULL/PATH/grimebusters-ops/scripts/check-replies.sh  >> /tmp/gb.log 2>&1
```
Windows: run the same scripts through Git Bash from Task Scheduler.

**7. Start**
```bash
claude
```
Marcus loads from CLAUDE.md automatically. Agent files load at startup — if
you edit one, restart.

## Test it before you trust it

- Paste a real Facebook post asking for a pressure washer → does Cole score
  it and draft something you'd actually send?
- "Should we run a fall gutter special?" → does Marcus fan out to Reese and
  Avery, or answer himself?
- "What do we charge for a 3,000 sq ft driveway?" → he should run
  `scripts/crm-query.py pricing` and answer from real completed jobs. Until
  the read-only key is in place, or for a service with no priced history,
  UNKNOWN is the correct answer. If he invents a number, that's a bug.
- "Write 3 Reels for a Crestwood driveway" → does Tyler ask for a real job?

## The correction loop

When an agent gets something wrong: tell Marcus, say "update Cole's file so
this doesn't happen again," read the diff, commit. Three weeks of that and
they sound like you.

Standing business rules go in `work/DECISIONS.md`, not in one agent's file —
otherwise the other five can't see them.

## Open items
See the conflicts section at the bottom of `context/CONFIG.md`. Conflict 4
(Firestore) is resolved bar the key. The other three are business calls only
Nicolas can make:

1. **Itemization** — running on the interim rule (line items by service, no
   unit costs). Confirm or change it.
2. **Priority ranking** — is `1` highest? Read as highest today, which puts
   booked revenue last.
3. **Cost policy** — resolved as Sonnet for all five specialists; noted here
   so it is visible rather than buried.
