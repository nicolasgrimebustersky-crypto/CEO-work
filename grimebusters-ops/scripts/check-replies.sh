#!/bin/bash
# Pull Nicolas's Telegram replies into work/inbox.md.
# Run before a session, or cron it every 30 min.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export DIR
source "$DIR/.env"

OFFSET=$(cat "$DIR/.tg_offset" 2>/dev/null || echo 0)
RESP=$(curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${OFFSET}")

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
