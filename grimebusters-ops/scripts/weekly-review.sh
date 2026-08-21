#!/bin/bash
# Weekly deeper review. Cron Friday 3:30pm -- after dismissal, not during class.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
LOG="${GB_LOG:-/tmp/gb.log}"

if ! command -v claude > /dev/null 2>&1; then
  FORCE=1 "$DIR/scripts/notify.sh" "⚠️ Weekly review skipped: \`claude\` not on PATH under cron. Use an absolute path in the crontab entry."
  exit 1
fi

REVIEW=$(claude -p "You are Marcus. Weekly review.
Read CLAUDE.md, context/, and everything in work/.
Cover: what moved this week, what did not, which agent actually produced
value, what to change next week, and where the 90-day priorities stand.
Be direct. Lead with anything bad. Output ONLY the review." 2>>"$LOG")

if [ $? -ne 0 ] || [ -z "$REVIEW" ]; then
  FORCE=1 "$DIR/scripts/notify.sh" "⚠️ Weekly review failed. Check $LOG"
  exit 1
fi

FORCE=1 "$DIR/scripts/notify.sh" "$REVIEW"
