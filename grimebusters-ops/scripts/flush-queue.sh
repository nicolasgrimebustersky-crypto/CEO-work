#!/bin/bash
# Send anything queued during school hours. Cron this at 3:10pm weekdays.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
Q="$DIR/work/queued-texts.log"
[ ! -s "$Q" ] && exit 0

BODY=$(cat "$Q")
FORCE=1 "$DIR/scripts/notify.sh" "📥 Queued during school:

$BODY"
> "$Q"
