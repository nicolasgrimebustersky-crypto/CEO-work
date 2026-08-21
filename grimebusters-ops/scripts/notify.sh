#!/bin/bash
# Send a Telegram message as Marcus.
# Usage: ./scripts/notify.sh "message"
# Respects quiet hours: 8:10am-3:10pm weekdays (school). Queues instead.
#
# Exits non-zero if the message did not reach Telegram, and says so. Marcus
# is not allowed to claim a text went out when it did not, so neither is this.
set -uo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$DIR/.env" ]; then
  echo "FAILED: no $DIR/.env. Copy .env.example and fill in TELEGRAM_TOKEN and TELEGRAM_CHAT_ID." >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$DIR/.env"

: "${TELEGRAM_TOKEN:=}"
: "${TELEGRAM_CHAT_ID:=}"
: "${TELEGRAM_API_BASE:=https://api.telegram.org}"

if [ -z "$TELEGRAM_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
  echo "FAILED: TELEGRAM_TOKEN or TELEGRAM_CHAT_ID is empty in $DIR/.env" >&2
  exit 1
fi

MSG="${1:-}"
[ -z "$MSG" ] && { echo "usage: notify.sh \"message\""; exit 1; }

# Quiet hours -- weekdays 8:10am (490) to 3:10pm (910).
DOW=$(date +%u)          # 1-5 = Mon-Fri
MINS=$((10#$(date +%H) * 60 + 10#$(date +%M)))
if [ "$DOW" -le 5 ] && [ "$MINS" -ge 490 ] && [ "$MINS" -lt 910 ]; then
  if [ "${FORCE:-}" != "1" ]; then
    echo "[$(date '+%F %T')] QUEUED: $MSG" >> "$DIR/work/queued-texts.log"
    echo "Quiet hours (school). Queued. Use FORCE=1 to override."
    exit 0
  fi
fi

# Returns the API response body, or empty on a transport failure.
send() {
  curl -s --max-time 20 -X POST "${TELEGRAM_API_BASE}/bot${TELEGRAM_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    "$@" \
    --data-urlencode text="$MSG"
}

RESP=$(send -d parse_mode="Markdown")

# Markdown is a nice-to-have, not worth losing a message over. Service names
# alone would sink it: pressure_washing and snow_removal each carry an
# unmatched underscore, so every price notification would 400 and vanish.
# Retry once as plain text rather than dropping it.
if [ -n "$RESP" ] && ! grep -q '"ok":true' <<< "${RESP// /}"; then
  case "$RESP" in
    *"can't parse entities"*|*"Can't parse entities"*)
      RESP=$(send)
      ;;
  esac
fi

if [ -z "$RESP" ]; then
  echo "FAILED: could not reach Telegram (network or timeout)." >&2
  exit 1
fi

if grep -q '"ok":true' <<< "${RESP// /}"; then
  echo "sent"
  exit 0
fi

DESC=$(sed -n 's/.*"description"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<< "$RESP")
echo "FAILED: Telegram rejected the message${DESC:+ -- $DESC}" >&2
exit 1
