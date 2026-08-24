#!/bin/bash
# Afternoon progress update. Cron at 3:30pm daily except Friday, when the
# deeper weekly review runs at the same time instead.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
LOG="${GB_LOG:-/tmp/gb.log}"

if ! command -v claude > /dev/null 2>&1; then
  "$DIR/scripts/notify.sh" "⚠️ Progress update skipped: \`claude\` not on PATH under cron." >> "$LOG" 2>&1
  exit 1
fi

UPDATE=$(claude -p "You are Marcus. It is 3:30pm — Nicolas's automated
afternoon progress update. Read CLAUDE.md, work/DECISIONS.md, work/inbox.md,
and work/leads.md, then text him:
- what the team accomplished today (only things that actually happened today)
- anything in progress right now
- anything that needs him — decisions, sends, approvals — or 'nothing'
Texts, not paragraphs: short lines, main details only. If genuinely nothing
happened today, say so in one line rather than padding.
Output ONLY the message text." 2>>"$LOG")

if [ $? -ne 0 ] || [ -z "$UPDATE" ]; then
  "$DIR/scripts/notify.sh" "⚠️ 3:30 progress update failed to generate. Check $LOG" >> "$LOG" 2>&1
  exit 1
fi

"$DIR/scripts/notify.sh" "$UPDATE"
