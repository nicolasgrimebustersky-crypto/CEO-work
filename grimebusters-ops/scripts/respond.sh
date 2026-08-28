#!/bin/bash
# Actually answers Nicolas's Telegram messages, not just queues them. Can
# delegate to a specialist (Grant/Cole/Reese/Avery/Tyler) when the message
# calls for real work, same as an interactive session would.
# Cron this every few minutes. Reuses check-replies.sh's pull and notify.sh's
# existing quiet-hours gate -- during quiet hours the reply still gets
# generated, but notify.sh queues it for 3:10pm instead of sending now.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
LOG="${GB_LOG:-/tmp/gb.log}"
LOCK="/tmp/gb-respond.lock"

# Delegation can mean waiting on a real specialist task -- minutes, not
# seconds. A second cron tick firing mid-run would race the first one on
# which lines in inbox.md are "new," so one run at a time, enforced by a
# PID-checked lock rather than just a lockfile's existence (a stale lock
# from a crashed run should not block forever).
if [ -f "$LOCK" ]; then
  OLD_PID=$(cat "$LOCK" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    exit 0
  fi
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

if ! command -v claude > /dev/null 2>&1; then
  FORCE=1 "$DIR/scripts/notify.sh" "⚠️ Auto-reply skipped: \`claude\` not on PATH under cron. Use an absolute path in the crontab entry." >> "$LOG" 2>&1
  exit 1
fi

# check-replies.sh reports failure on stderr and through its exit status, so
# the status is what to test -- stderr is already going to the log.
if ! "$DIR/scripts/check-replies.sh" >>"$LOG" 2>&1; then
  echo "[$(date '+%F %T')] check-replies failed; no reply attempted this run" >> "$LOG"
  exit 1
fi

# Anything still unmarked is unanswered, whether it arrived on this poll or on
# an earlier one whose reply failed to send. Gating on "did this poll bring
# something new" instead would strand a message permanently the first time a
# send failed: no new message means no next attempt. Two tag words excluded
# here: "[replied" is this script's own mark, "[handled" is how entries from
# before this script existed were marked by hand -- without excluding both,
# those old lines get swept back into the prompt and re-marked "[replied" on
# top of their existing tag the first time anything new comes in.
NEW=$(grep -E '^\- \[[0-9-]+ [0-9:]+\] ' work/inbox.md | grep -v -E '\[(replied|handled)' || true)
[ -z "$NEW" ] && exit 0

# claude -p takes real seconds-to-minutes (reading context, maybe
# delegating) -- an instant ack is what makes this feel like texting
# instead of waiting in silence. But only on the first message of a
# conversation, not every single text once things are already flowing --
# skip it if the last reply went out within the last 10 minutes. Fire-and-
# forget: does not affect marking or retries, and respects quiet hours the
# same as the real reply since it goes through notify.sh too.
LAST_REPLY_FILE="$DIR/.last_reply_at"
NOW_EPOCH=$(date +%s)
LAST_REPLY_EPOCH=$(cat "$LAST_REPLY_FILE" 2>/dev/null || echo 0)
case "$LAST_REPLY_EPOCH" in (*[!0-9]*|"") LAST_REPLY_EPOCH=0 ;; esac
# Nicolas's spec (2026-08-24): the ack fires on the first contact of a
# calendar day, or when the conversation has sat quiet for more than an
# hour. Inside an active conversation it stays out of the way.
# `date -r <epoch>` is a BSD/macOS spelling. GNU date (Git Bash on the Windows
# box) reads -r as "use this file's mtime" and fails on a bare number, which
# silently fell through to "never" -- making the ack fire on every single
# message instead of the first of the day. Try GNU form first, then BSD.
LAST_REPLY_DAY=$(date -d "@$LAST_REPLY_EPOCH" '+%F' 2>/dev/null \
  || date -r "$LAST_REPLY_EPOCH" '+%F' 2>/dev/null \
  || echo "never")
TODAY=$(date '+%F')
if [ "$LAST_REPLY_DAY" != "$TODAY" ] || [ $((NOW_EPOCH - LAST_REPLY_EPOCH)) -gt 3600 ]; then
  "$DIR/scripts/notify.sh" "👀 on it" >> "$LOG" 2>&1
  echo "[$(date '+%F %T')] ack sent (last reply: $LAST_REPLY_DAY, gap $((NOW_EPOCH - LAST_REPLY_EPOCH))s)" >> "$LOG"
fi

# There is no hang backstop on this call any more -- see the note at the wait
# below. The lock above is what prevents overlap; nothing bounds a single run.
REPLY_FILE=$(mktemp)
claude -p "You are Marcus. Nicolas just sent this via Telegram:

$NEW

Your standard pre-response reading: CLAUDE.md, context/CONFIG.md,
context/BRAND.md, context/PRICING.md, and work/DECISIONS.md. Pull in
anything else -- other context/ files, work/leads.md, work/site-changes.md,
etc. -- only if this specific message actually needs it.

If what he is asking for is real work, not just a question -- outreach, a
site check, content, research, an offer -- delegate to the right specialist
exactly like you would in a normal session: Grant (site/deploys/SEO), Cole
(outreach/leads), Reese (offers/campaigns), Avery (research/trends), Tyler
(content). Spawn them, wait for what they produce, and fold it into your
reply naming who contributed -- never hide the machinery. Only skip
delegation for something you can answer directly: a quick status check, a
yes/no on something already logged, a simple question.

Hard honesty rule -- this one is why it exists: on 2026-08-25 a reply
claimed drafts that did not exist, and Nicolas went looking for them.
Never say you created, drafted, sent, or scheduled anything unless a tool
call in THIS run actually did it and you saw it succeed. This headless
environment has NO Gmail access -- you cannot create email drafts here,
ever. If he asks for email outreach: gather and verify leads per the
DECISIONS.md verification rule, log them to work/leads.md, put the email
TEXT in your reply for his approval, and say plainly that loading drafts
into his Gmail needs the interactive session. CRM draft estimates you CAN
create, via scripts/create-estimate.ts -- but only claim one exists after
the script prints 'Created draft estimate'.

Then answer him directly like you are texting him right now -- not a
report, not a recap of what you did. Nicolas wants texts, not paragraphs:
short, summarized, main details only, bullet points over prose. If there's
more than a couple of lines' worth of information, split it into multiple
short separate messages instead of one long block -- put the delimiter
line '---MSG---' alone on its own line between each one. If he asked
something you cannot answer without him -- a decision, a missing number,
something only he can authorize -- say so plainly and ask, still short.
Output ONLY the reply text (with '---MSG---' between messages if you're
sending more than one). No preamble, no meta-commentary about what you're
doing." > "$REPLY_FILE" 2>>"$LOG" &
CLAUDE_PID=$!
# No timeout. Removed on Nicolas's instruction 2026-08-25: delegated work
# (lead gathering, Maps verification, estimate drafting) was being killed
# mid-run at 600s and every retry produced nothing. Marcus now runs to
# completion, however long that takes.
#
# Trade-off this accepts: a wedged claude holds $LOCK indefinitely and every
# later message goes unanswered with no error. Marcus-RespondFallback is still
# capped by its PT1H ExecutionTimeLimit, but Marcus-Watch is PT0S (no limit),
# so a hang on the watcher path persists until it is killed by hand. Recovery:
# kill the claude process under the pid in /tmp/gb-respond.lock, or run
# marcus-runtime/disable-tasks.ps1 then enable-tasks.ps1.
wait "$CLAUDE_PID" 2>/dev/null
CLAUDE_STATUS=$?
REPLY=$(cat "$REPLY_FILE")
rm -f "$REPLY_FILE"

if [ "$CLAUDE_STATUS" -ne 0 ] || [ -z "$REPLY" ]; then
  FORCE=1 "$DIR/scripts/notify.sh" "⚠️ Auto-reply failed to generate. Check $LOG -- your message is still sitting in work/inbox.md, unanswered." >> "$LOG" 2>&1
  exit 1
fi

# A reply can be multiple short texts instead of one long block --
# '---MSG---' alone on its own line splits them. Split into a temp file per
# part (safer than trying to pass multi-line values through a bash array),
# send each as its own Telegram message in order. If any part fails, treat
# the whole reply as undelivered so the retry logic re-sends everything
# rather than leaving a partial answer marked complete.
PARTS_DIR=$(mktemp -d)
# Git Bash hands python a POSIX path like /tmp/tmp.XXXX, but python here is a
# native Windows build and reads that as C:\tmp\tmp.XXXX, which does not exist.
# Every part file failed to open, the loop below found nothing to send, and the
# message got marked answered with no reply ever going out. cygpath gives python
# a path it can actually open; passing it through the environment avoids
# escaping backslashes into the source. The explicit UTF-8 matters too: Windows
# Python defaults to cp1252 and would fail on any emoji in the reply.
PARTS_NATIVE=$(cygpath -w "$PARTS_DIR" 2>/dev/null || printf '%s' "$PARTS_DIR")
printf '%s' "$REPLY" | PARTS_DIR="$PARTS_NATIVE" python3 -c "
import sys, re, os
d = os.environ['PARTS_DIR']
parts = re.split(r'\n---MSG---\n', sys.stdin.read().strip())
for i, p in enumerate(parts):
    p = p.strip()
    if p:
        with open(os.path.join(d, '%03d' % i), 'w', encoding='utf-8') as f:
            f.write(p)
"

# A reply that exists but produced no part files must not be treated as sent.
# Falling through would mark the message answered having sent nothing, which is
# the one failure this system is not allowed to have.
if ! ls "$PARTS_DIR"/* >/dev/null 2>&1; then
  echo "[$(date '+%F %T')] reply split produced no parts; inbox left unmarked" >> "$LOG"
  FORCE=1 "$DIR/scripts/notify.sh" "⚠️ Reply generated but could not be split for sending. Your message is still unanswered in work/inbox.md." >> "$LOG" 2>&1
  rm -rf "$PARTS_DIR"
  exit 1
fi

SENT_STATUS=0
for PART_FILE in "$PARTS_DIR"/*; do
  [ -f "$PART_FILE" ] || continue
  "$DIR/scripts/notify.sh" "$(cat "$PART_FILE")"
  PART_STATUS=$?
  [ "$PART_STATUS" -ne 0 ] && SENT_STATUS=$PART_STATUS
done
rm -rf "$PARTS_DIR"

# Nothing gets marked answered unless the reply actually went out. notify.sh
# returns 0 when it queues for quiet hours, so a queued reply still counts --
# it is going to be delivered. A real failure leaves inbox.md untouched so the
# next run picks the same message up again. Marking on a failed send would
# lose Nicolas's message silently, which is the one thing this system is not
# allowed to do.
if [ "$SENT_STATUS" -ne 0 ]; then
  echo "[$(date '+%F %T')] reply not delivered; inbox.md left unmarked for retry" >> "$LOG"
  exit "$SENT_STATUS"
fi

# Marks the conversation as "already flowing" so the next message's ack gets
# skipped -- see the LAST_REPLY_FILE check above.
date +%s > "$LAST_REPLY_FILE"

# Tell the command centre at /marcus that this happened. Placed after the
# delivery check on purpose: the feed is a record of replies that actually
# went out, so a failed send leaves no line claiming one did. ops-publish.sh
# never returns non-zero, so nothing below this depends on it working.
"$DIR/scripts/ops-publish.sh" agent --id marcus --status working \
  --task "answering Nicolas on Telegram"
"$DIR/scripts/ops-publish.sh" feed --who marcus \
  --text "replied to Nicolas on Telegram ($(printf '%s' "$REPLY" | wc -c | tr -d ' ') chars)"

# Mark only the lines that were actually in the prompt. check-replies.sh also
# runs on its own cron, so a message can land in inbox.md while claude -p is
# still thinking -- marking every unmarked line would stamp that one answered
# without it ever having been read.
# surrogateescape on both read and write so a byte that is not valid UTF-8 --
# anything cp1252 wrote into this file before the encoding was pinned -- round
# trips unchanged instead of raising or being replaced. A line that cannot be
# matched is a line that never gets marked, and an unmarked line is answered
# again on the next run.
# The answered lines go through a file, not the environment. Passing them as an
# env var re-decoded them with a different codec than the file read used, so any
# byte that was not valid UTF-8 came out as a different string on each side and
# the line never matched. Same file, same codec, both sides -- bytes round trip.
#
# newline='' stops Windows Python translating '\n' into '\r\n' on write, which
# left a stray '\r' on every line and broke the match on the *next* run.
ANSWERED_FILE=$(mktemp)
printf '%s\n' "$NEW" > "$ANSWERED_FILE"
ANSWERED_NATIVE=$(cygpath -w "$ANSWERED_FILE" 2>/dev/null || printf '%s' "$ANSWERED_FILE")
MARK_LOG=$(ANSWERED_FILE="$ANSWERED_NATIVE" python3 -c "
import os
enc = dict(encoding='utf-8', errors='surrogateescape')
with open(os.environ['ANSWERED_FILE'], newline='', **enc) as f:
    answered = {l.rstrip('\r\n') for l in f if l.strip()}
marked = 0
if answered:
    with open('work/inbox.md', newline='', **enc) as f:
        lines = f.readlines()
    with open('work/inbox.md', 'w', newline='', **enc) as f:
        for line in lines:
            stripped = line.rstrip('\r\n')
            if stripped in answered:
                line = stripped + ' [replied]\n'
                marked += 1
            f.write(line)
print(f'marked {marked} line(s)')
" 2>&1)
rm -f "$ANSWERED_FILE"
echo "$MARK_LOG" >> "$LOG"

# Replies went out but nothing got marked: the next run will answer the exact
# same message again, and keep doing it every five minutes. Say so loudly rather
# than quietly spamming Nicolas.
case "$MARK_LOG" in
  "marked 0 line"*)
    echo "[$(date '+%F %T')] WARNING: replies sent but 0 lines marked -- duplicate replies will follow" >> "$LOG"
    FORCE=1 "$DIR/scripts/notify.sh" "⚠️ Replied, but could not mark your message answered in work/inbox.md. You will get duplicate replies every 5 min until that line is marked [replied] by hand." >> "$LOG" 2>&1
    ;;
esac

exit 0
