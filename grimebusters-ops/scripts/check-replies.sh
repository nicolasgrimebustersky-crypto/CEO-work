#!/bin/bash
# Pull Nicolas's Telegram replies into work/inbox.md.
# Run before a session, or cron it every 30 min.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export DIR

if [ ! -f "$DIR/.env" ]; then
  echo "FAILED: no $DIR/.env. See scripts/README-firestore.md's sibling setup in README.md." >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$DIR/.env"
: "${TELEGRAM_TOKEN:=}"
: "${TELEGRAM_API_BASE:=https://api.telegram.org}"
[ -z "$TELEGRAM_TOKEN" ] && { echo "FAILED: TELEGRAM_TOKEN is empty in $DIR/.env" >&2; exit 1; }

# A non-numeric offset would be rejected by Telegram and silently return
# nothing, which reads as "no replies" rather than as a broken poller.
# Resetting to 0 replays whatever Telegram still holds (about 24 hours), so a
# corrupted offset duplicates a few lines in the inbox instead of skipping a
# reply. Duplicates are noise; a skipped reply is a message from Nicolas that
# Marcus never sees.
OFFSET=$(cat "$DIR/.tg_offset" 2>/dev/null || echo 0)
case "$OFFSET" in (*[!0-9]*|"") OFFSET=0 ;; esac

RESP=$(curl -s --max-time 20 "${TELEGRAM_API_BASE}/bot${TELEGRAM_TOKEN}/getUpdates?offset=${OFFSET}")
if [ -z "$RESP" ]; then
  echo "FAILED: could not reach Telegram (network or timeout)." >&2
  exit 1
fi

echo "$RESP" | python3 -c '
import sys, json, datetime, os
DIR = os.environ["DIR"]
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if not d.get("ok"):
    sys.exit(0)
lines, last = [], None
for u in d.get("result", []):
    last = u["update_id"] + 1
    m = u.get("message", {})
    t = m.get("text")
    if t:
        ts = datetime.datetime.fromtimestamp(m["date"]).strftime("%F %H:%M")
        lines.append("- [%s] %s" % (ts, t))
if lines:
    with open(DIR + "/work/inbox.md", "a") as f:
        f.write("\n" + "\n".join(lines) + "\n")
    print("%d new message(s)" % len(lines))
if last:
    open(DIR + "/.tg_offset", "w").write(str(last))
'
