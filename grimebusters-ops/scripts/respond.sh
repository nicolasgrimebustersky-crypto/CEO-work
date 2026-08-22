#!/bin/bash
# Actually answers Nicolas's Telegram messages, not just queues them.
# Cron this every few minutes. Reuses check-replies.sh's pull (which also
# advances .tg_offset, so a message is never picked up twice) and notify.sh's
# existing quiet-hours gate -- during quiet hours the reply still gets
# generated, but notify.sh queues it for 3:10pm instead of sending now.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
LOG="${GB_LOG:-/tmp/gb.log}"

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

REPLY=$(claude -p "You are Marcus. Nicolas just sent this via Telegram:

$NEW

Read CLAUDE.md, context/, and work/ as usual, then answer him directly like
you are replying in the chat right now -- not a report, not a recap of what
you did, an actual answer to what he asked. Keep it to his usual length
(1-2 sentences by default, expand only if the question genuinely needs it).
If he asked something you cannot answer without him -- a decision, a missing
number, something only he can authorize -- say so plainly and ask.
Output ONLY the reply text. No preamble, no meta-commentary about what
you're doing." 2>>"$LOG")

if [ $? -ne 0 ] || [ -z "$REPLY" ]; then
  FORCE=1 "$DIR/scripts/notify.sh" "⚠️ Auto-reply failed to generate. Check $LOG -- your message is still sitting in work/inbox.md, unanswered." >> "$LOG" 2>&1
  exit 1
fi

"$DIR/scripts/notify.sh" "$REPLY"
SENT_STATUS=$?

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
ANSWERED="$NEW" python3 - <<'PYEOF'
import os

answered = {l for l in os.environ["ANSWERED"].splitlines() if l.strip()}
if answered:
    with open("work/inbox.md") as f:
        lines = f.readlines()
    with open("work/inbox.md", "w") as f:
        for line in lines:
            if line.rstrip("\n") in answered:
                line = line.rstrip("\n") + " [replied]\n"
            f.write(line)
PYEOF

exit 0
