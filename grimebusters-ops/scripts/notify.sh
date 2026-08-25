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

# Quiet hours removed on Nicolas's instruction, 2026-08-24. Everything sends
# immediately; the 3:30pm progress update (scripts/progress-update.sh) is the
# scheduled touchpoint. FORCE=1 is accepted for compatibility and ignored.

# --- TEMPORARY DEBUG (2026-08-25, chasing the Telegram UTF-8 400) ---
# Dumps the exact bytes this call is about to send, so an invalid-UTF-8 payload
# can be inspected instead of guessed at. To remove: restore
# scripts/notify.sh.bak.20260825-0750.
GB_MSGDUMP="/c/Users/Owner/marcus-runtime/logs/msgdump"
mkdir -p "$GB_MSGDUMP" 2>/dev/null
printf '%s' "$MSG" > "$GB_MSGDUMP/$(date '+%Y%m%d-%H%M%S')-$$.bin" 2>/dev/null
# --- END TEMPORARY DEBUG ---

# Telegram rejects the whole message with "text must be encoded in UTF-8" if
# the payload contains a single byte that is not valid UTF-8 -- one stray byte
# loses the entire reply. Several things on this box can produce one: Windows
# Python defaulting to cp1252, a file written before an encoding was pinned, or
# text that has been round-tripped through a non-UTF-8 step.
#
# So repair the bytes here, at the last point before they go out, rather than
# trying to guarantee every upstream producer is clean. Valid UTF-8 sequences
# pass through untouched; a stray byte is interpreted as cp1252 (which is what
# actually wrote it) and re-encoded properly, so a curly quote stays a curly
# quote instead of being deleted.
#
# Reads and writes raw bytes via stdin.buffer/stdout.buffer, so this does not
# itself depend on PYTHONUTF8 or the console code page.
GB_SANITISED=$(printf '%s' "$MSG" | python3 -c '
import sys
raw = sys.stdin.buffer.read()
out = bytearray(); i = 0
while i < len(raw):
    for n in (1, 2, 3, 4):
        chunk = raw[i:i+n]
        try:
            chunk.decode("utf-8"); out += chunk; i += n; break
        except UnicodeDecodeError:
            continue
    else:
        out += raw[i:i+1].decode("cp1252", errors="replace").encode("utf-8"); i += 1
sys.stdout.buffer.write(bytes(out))
' 2>/dev/null)

# Never let a broken or missing python turn a real message into an empty one --
# an unsendable message is recoverable, a silently blank one is not.
if [ -n "$GB_SANITISED" ]; then
  if [ "$GB_SANITISED" != "$MSG" ]; then
    echo "notify.sh: repaired invalid UTF-8 in outgoing message" >&2
  fi
  MSG="$GB_SANITISED"
fi

# Returns the API response body, or empty on a transport failure.
send() {
  # The message body goes to curl through a FILE, never through argv.
  #
  # Git Bash hands arguments to the native curl.exe through the MSYS runtime,
  # which transcodes them from UTF-8 to the ANSI code page (cp1252 here). A
  # wire trace of the old argv form showed exactly that:
  #     text=em-dash+%97+bullet+%95+warn+%3F
  # An em dash (U+2014) went out as the single byte 0x97 and a bullet (U+2022)
  # as 0x95 -- neither is valid UTF-8, so Telegram rejected the whole message
  # with "text must be encoded in UTF-8" and the reply was lost. A warning sign
  # (U+26A0) has no cp1252 equivalent so it became a literal "?", which is why
  # Nicolas saw "??" in a message that did send, on 2026-08-25.
  #
  # --data-urlencode text@FILE makes curl read the bytes itself, so nothing
  # crosses the argv boundary but an ASCII path. Newlines are preserved (they
  # arrive as %0A), unlike the -d @file form which strips them.
  local body wbody rc
  body=$(mktemp) || return 1
  printf %s "$MSG" > "$body"
  # mingw curl cannot open a POSIX /tmp/... path; it needs the Windows form.
  wbody=$(cygpath -w "$body" 2>/dev/null || printf %s "$body")
  curl -s --max-time 20 "${TELEGRAM_API_BASE}/bot${TELEGRAM_TOKEN}/sendMessage" -d chat_id="${TELEGRAM_CHAT_ID}" "$@" --data-urlencode "text@$wbody"
  rc=$?
  rm -f "$body"
  return $rc
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
