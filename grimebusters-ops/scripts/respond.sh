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

PULL_OUT=$("$DIR/scripts/check-replies.sh" 2>>"$LOG")
if echo "$PULL_OUT" | grep -q "^FAILED"; then
  echo "$PULL_OUT" >> "$LOG"
  exit 1
fi
if ! echo "$PULL_OUT" | grep -q "new message"; then
  exit 0
fi

# Lines not yet marked [replied] are the ones new since the last successful
# run of this script -- Telegram's own offset already guarantees inbox.md
# never gets a duplicate line in the first place.
NEW=$(grep -E '^\- \[[0-9-]+ [0-9:]+\] ' work/inbox.md | grep -v '\[replied' || true)
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

python3 - <<'PYEOF'
import re
with open("work/inbox.md") as f:
    lines = f.readlines()
with open("work/inbox.md", "w") as f:
    for line in lines:
        if re.match(r'^\- \[[0-9-]+ [0-9:]+\] ', line) and '[replied' not in line:
            line = line.rstrip("\n") + " [replied]\n"
        f.write(line)
PYEOF

exit $SENT_STATUS
