#!/bin/bash
# Send a Telegram message as Marcus.
# Usage: ./scripts/notify.sh "message"
# Respects quiet hours: 8:10am-3:10pm weekdays (school). Queues instead.

DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$DIR/.env"

MSG="$1"
[ -z "$MSG" ] && { echo "usage: notify.sh \"message\""; exit 1; }

# Quiet hours check -- weekdays 8:10am to 3:10pm
DOW=$(date +%u)          # 1-5 = Mon-Fri
MINS=$((10#$(date +%H) * 60 + 10#$(date +%M)))
if [ "$DOW" -le 5 ] && [ "$MINS" -ge 490 ] && [ "$MINS" -lt 910 ]; then
  if [ "$FORCE" != "1" ]; then
    echo "[$(date '+%F %T')] QUEUED: $MSG" >> "$DIR/work/queued-texts.log"
    echo "Quiet hours (school). Queued. Use FORCE=1 to override."
    exit 0
  fi
fi

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d parse_mode="Markdown" \
  --data-urlencode text="$MSG" > /dev/null

[ $? -eq 0 ] && echo "sent" || echo "FAILED"
