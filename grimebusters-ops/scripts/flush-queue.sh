#!/bin/bash
# Send anything queued during school hours. Cron this at 3:10pm weekdays.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
Q="$DIR/work/queued-texts.log"
[ ! -s "$Q" ] && exit 0

# Claim the queue by moving it aside first. A message queued while the send is
# in flight lands in a fresh file and goes out next time, instead of being
# truncated away unread.
CLAIM="$Q.sending.$$"
mv "$Q" "$CLAIM" || exit 1

BODY=$(cat "$CLAIM")
if FORCE=1 "$DIR/scripts/notify.sh" "📥 Queued during school:

$BODY"; then
  rm -f "$CLAIM"
else
  # Put it back at the front so nothing is lost, and let cron retry.
  cat "$CLAIM" "$Q" > "$Q.restored" 2>/dev/null || cp "$CLAIM" "$Q.restored"
  mv "$Q.restored" "$Q"
  rm -f "$CLAIM"
  echo "Send failed; queue preserved for the next run." >&2
  exit 1
fi
