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

# claude -p's own timeout, as a backstop against a true hang (a stuck tool
# call, not normal delegation runtime) -- not a normal-duration cutoff. Real
# delegated work has taken 8+ minutes in this system before, so this is
# generous on purpose. The lock above is what actually prevents overlap;
# this is only here so one wedged run can't block every future tick forever.
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
( sleep 600 && kill -TERM "$CLAUDE_PID" 2>/dev/null ) &
WATCHER_PID=$!
wait "$CLAUDE_PID" 2>/dev/null
CLAUDE_STATUS=$?
kill "$WATCHER_PID" 2>/dev/null
wait "$WATCHER_PID" 2>/dev/null
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
printf '%s' "$REPLY" | python3 -c "
import sys, re
parts = re.split(r'\n---MSG---\n', sys.stdin.read().strip())
for i, p in enumerate(parts):
    p = p.strip()
    if p:
        with open('$PARTS_DIR/%03d' % i, 'w') as f:
            f.write(p)
"
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

# Mark only the lines that were actually in the prompt. check-replies.sh also
# runs on its own cron, so a message can land in inbox.md while claude -p is
# still thinking -- marking every unmarked line would stamp that one answered
# without it ever having been read.
MARK_LOG=$(ANSWERED="$NEW" python3 -c "
import os
answered = {l for l in os.environ['ANSWERED'].splitlines() if l.strip()}
marked = 0
if answered:
    with open('work/inbox.md') as f:
        lines = f.readlines()
    with open('work/inbox.md', 'w') as f:
        for line in lines:
            if line.rstrip('\n') in answered:
                line = line.rstrip('\n') + ' [replied]\n'
                marked += 1
            f.write(line)
print(f'marked {marked} line(s)')
" 2>&1)
echo "$MARK_LOG" >> "$LOG"

exit 0
