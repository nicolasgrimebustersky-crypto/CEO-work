#!/usr/bin/env bash
#
# Best-effort wrapper around scripts/ops-publish.ts, for calling from the other
# shell scripts.
#
# Two rules, both deliberate:
#
#   1. It never fails the caller. Publishing to the dashboard is telemetry, not
#      the work. A Firestore hiccup must not stop Marcus replying to a text or
#      leave a message marked unanswered — the reply is the job, this is the
#      readout of it.
#
#   2. It only ever runs after the thing it describes has actually happened.
#      Call it on the success path, never before or "optimistically": a feed
#      entry for a reply that did not send would put a line on the board saying
#      work happened that did not, which is the one failure this whole screen
#      exists to avoid.
#
# Usage (same arguments as ops-publish.ts):
#   scripts/ops-publish.sh feed --who marcus --text "replied to Nicolas"
#   scripts/ops-publish.sh agent --id marcus --status working --task "..."
#
# Output goes to work/ops-publish.log so a persistent failure is findable
# rather than silent.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$DIR/work/ops-publish.log"

# The dashboard bridge is opt-in: without a crew credential in .env there is
# nothing to publish with, and every call would fail identically. Silence in
# that case is correct — the CRM screen simply shows nothing reporting.
if ! grep -q '^CREW_EMAIL=' "$DIR/.env" 2>/dev/null; then
  exit 0
fi

mkdir -p "$DIR/work"

# 25s is well under respond.sh's own cadence, so a wedged network call cannot
# pile runs up behind it.
if command -v timeout >/dev/null 2>&1; then
  timeout 25 node --experimental-strip-types "$DIR/scripts/ops-publish.ts" "$@" \
    >> "$LOG" 2>&1
else
  node --experimental-strip-types "$DIR/scripts/ops-publish.ts" "$@" >> "$LOG" 2>&1
fi

STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "[$(date '+%F %T')] publish failed ($STATUS): $*" >> "$LOG"
fi

# Always zero. See rule 1 above.
exit 0
