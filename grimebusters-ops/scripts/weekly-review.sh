#!/bin/bash
# Weekly deeper review. Cron Friday 3:30pm -- after dismissal, not during class.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1

REVIEW=$(claude -p "You are Marcus. Weekly review.
Read CLAUDE.md, context/, and everything in work/.
Cover: what moved this week, what did not, which agent actually produced
value, what to change next week, and where the 90-day priorities stand.
Be direct. Lead with anything bad. Output ONLY the review." 2>&1)

FORCE=1 "$DIR/scripts/notify.sh" "$REVIEW"
