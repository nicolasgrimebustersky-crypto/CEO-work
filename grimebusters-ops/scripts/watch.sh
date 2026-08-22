#!/bin/bash
# Persistent long-poll watcher -- the actual "instant" mechanism. Telegram's
# getUpdates supports holding the connection open (the `timeout` param below)
# and returning the moment a message arrives, instead of the up-to-5-minute
# dead air a fixed cron interval has by construction. No server, no webhook --
# just one continuously-running process on this Mac instead of periodic ones.
#
# This does not replace respond.sh's own logic (the reply generation, the
# retry/lock/marking safety, quiet hours) -- it only replaces HOW that logic
# gets triggered. Each loop iteration does a read-only peek at whatever
# update is currently sitting past .tg_offset; the moment one exists, it
# calls respond.sh, which does the real, authoritative pull (via
# check-replies.sh) and advances the offset itself. The peek never consumes
# anything on its own, so there's no double-processing risk.
#
# Install as a LaunchAgent (see scripts/com.grimebusters.marcuswatch.plist)
# so it starts on login and restarts itself if it ever dies -- cron cannot
# run something that stays alive between ticks, this has to be launchd.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
LOG="${GB_LOG:-/tmp/gb-watch.log}"

if [ ! -f "$DIR/.env" ]; then
  echo "[$(date '+%F %T')] FAILED: no .env, exiting" >> "$LOG"
  exit 1
fi
# shellcheck disable=SC1091
source "$DIR/.env"
: "${TELEGRAM_TOKEN:=}"
: "${TELEGRAM_API_BASE:=https://api.telegram.org}"
if [ -z "$TELEGRAM_TOKEN" ]; then
  echo "[$(date '+%F %T')] FAILED: TELEGRAM_TOKEN empty, exiting" >> "$LOG"
  exit 1
fi

echo "[$(date '+%F %T')] watcher started, pid $$" >> "$LOG"

while true; do
  OFFSET=$(cat "$DIR/.tg_offset" 2>/dev/null || echo 0)
  case "$OFFSET" in (*[!0-9]*|"") OFFSET=0 ;; esac

  # Long poll: Telegram holds this request open up to 50s, returning the
  # instant something new lands, or an empty result at the timeout. --max-time
  # is set slightly above the Telegram-side timeout so curl doesn't cut off a
  # response that's about to arrive.
  RESP=$(curl -s --max-time 55 "${TELEGRAM_API_BASE}/bot${TELEGRAM_TOKEN}/getUpdates?offset=${OFFSET}&timeout=50")

  if [ -z "$RESP" ]; then
    # Network hiccup or Telegram-side issue -- brief backoff, not a fast spin.
    sleep 5
    continue
  fi

  HAS_UPDATE=$(echo "$RESP" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('no')
    sys.exit()
print('yes' if d.get('ok') and d.get('result') else 'no')
")

  if [ "$HAS_UPDATE" = "yes" ]; then
    bash "$DIR/scripts/respond.sh" >> "$LOG" 2>&1
  fi
done
