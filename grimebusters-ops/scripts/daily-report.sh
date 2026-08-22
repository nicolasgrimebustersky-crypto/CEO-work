#!/bin/bash
# Daily report. Cron at 7:00am.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
LOG="${GB_LOG:-/tmp/gb.log}"

if ! command -v claude > /dev/null 2>&1; then
  FORCE=1 "$DIR/scripts/notify.sh" "⚠️ Daily report skipped: \`claude\` not on PATH under cron. Use an absolute path in the crontab entry."
  exit 1
fi

DOW=$(date +%u)
if [ "$DOW" -eq 7 ]; then
  LEN="Sunday: full report, no word cap. Include the week in review."
else
  LEN="Weekday: under 150 words."
fi

REPORT=$(claude -p "You are Marcus. Read CLAUDE.md, context/, and work/.
Produce today's daily report in the format defined in CLAUDE.md.
$LEN
Send it even if the day was flat -- numbers go out regardless.
If a number is unknown, write UNKNOWN. Never estimate.
Output ONLY the report text, no preamble." 2>>"$LOG")

if [ $? -ne 0 ] || [ -z "$REPORT" ]; then
  FORCE=1 "$DIR/scripts/notify.sh" "⚠️ Daily report failed. Check $LOG"
  exit 1
fi

FORCE=1 "$DIR/scripts/notify.sh" "$REPORT"
