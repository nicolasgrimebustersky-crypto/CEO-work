#!/usr/bin/env bash
#
# Boots everything tests/api.auth.test.mjs needs, runs it, and tears down.
#
#   npm run test:api
#
# What this stands up:
#   - Auth + Firestore emulators on a throwaway demo project
#   - two crew accounts, seeded, with their uids fed to the server as CREW_UIDS
#   - a production build of the app pointed at those emulators
#   - deliberately fake but well-formed Twilio credentials, so the SMS routes
#     get past their "is Twilio configured" check and exercise the auth and
#     rate-limit logic without any message being sent anywhere
#   - a second copy of the same build with NO service account, which is what a
#     half-configured deployment looks like — the one case where the server
#     must not blame the caller's login for a missing deployment variable
#
set -euo pipefail

PROJECT="demo-grimebusters-apitest"
PORT="${TEST_PORT:-3399}"
# A second server on the next port, started deliberately WITHOUT a service
# account, so the "not configured" path can be tested against a real response.
UNCONFIGURED_PORT="$((${TEST_PORT:-3399} + 1))"
AUTH_PORT="${TEST_AUTH_PORT:-9399}"
FIRESTORE_PORT="${TEST_FIRESTORE_PORT:-8399}"
WORK="$(mktemp -d)"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# `npx next start` spawns a next-server child of its own, and killing the npx
# wrapper leaves that child holding the port. The orphan then answers the *next*
# run's requests with the previous run's crew uids, and seven tests fail with a
# 403 that has nothing to do with the code being tested. So each server is
# started with setsid and torn down by process group, with the port itself
# checked afterwards as a backstop.
killPort() {
  local port="$1"
  fuser -k -n tcp "$port" 2>/dev/null || true
}

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill -- "-$SERVER_PID" 2>/dev/null || true
  [[ -n "${BARE_PID:-}" ]] && kill -- "-$BARE_PID" 2>/dev/null || true
  [[ -n "${EMU_PID:-}" ]] && kill "$EMU_PID" 2>/dev/null || true
  killPort "$PORT"
  killPort "$UNCONFIGURED_PORT"
  pkill -f "cloud-firestore-emulator" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

cd "$ROOT"

# Its own config on dedicated ports with the UI off, so this can run while a
# `npm run emulators` session is already up and doesn't fight it for port 4000.
cat > "$WORK/firebase.json" <<JSON
{
  "firestore": { "rules": "$ROOT/firestore.rules", "indexes": "$ROOT/firestore.indexes.json" },
  "emulators": {
    "auth": { "host": "127.0.0.1", "port": $AUTH_PORT },
    "firestore": { "host": "127.0.0.1", "port": $FIRESTORE_PORT },
    "ui": { "enabled": false },
    "singleProjectMode": true
  }
}
JSON

echo "==> starting emulators (auth :$AUTH_PORT, firestore :$FIRESTORE_PORT)"
npx firebase emulators:start --only auth,firestore --project "$PROJECT" \
  --config "$WORK/firebase.json" > "$WORK/emulators.log" 2>&1 &
EMU_PID=$!

for _ in $(seq 1 60); do
  grep -q "All emulators ready" "$WORK/emulators.log" && break
  sleep 1
done
grep -q "All emulators ready" "$WORK/emulators.log" || {
  echo "emulators failed to start:"; tail -20 "$WORK/emulators.log"; exit 1;
}

echo "==> seeding crew accounts and fixtures"
UIDS="$(FIREBASE_PROJECT="$PROJECT" AUTH_EMULATOR_PORT="$AUTH_PORT" FIRESTORE_EMULATOR_PORT="$FIRESTORE_PORT" node scripts/seed-test-data.mjs)"
NICK="$(node -e "console.log(JSON.parse(process.argv[1]).nick)" "$UIDS")"
DANA="$(node -e "console.log(JSON.parse(process.argv[1]).dana)" "$UIDS")"

# A syntactically valid RSA key is enough: the Admin SDK only parses it, and
# against the emulators it never signs or verifies anything with it.
openssl genrsa -out "$WORK/fake.key" 2048 2>/dev/null
SA_B64="$(node -e "
const fs = require('fs');
const key = fs.readFileSync(process.argv[1], 'utf8');
process.stdout.write(Buffer.from(JSON.stringify({
  type: 'service_account',
  project_id: process.argv[2],
  private_key_id: 'test',
  private_key: key,
  client_email: 'test@' + process.argv[2] + '.iam.gserviceaccount.com',
  client_id: '1',
})).toString('base64'));
" "$WORK/fake.key" "$PROJECT")"

echo "==> building"
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true \
NEXT_PUBLIC_FIREBASE_API_KEY=fake-api-key \
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="$PROJECT.firebaseapp.com" \
NEXT_PUBLIC_FIREBASE_PROJECT_ID="$PROJECT" \
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="$PROJECT.appspot.com" \
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1 \
NEXT_PUBLIC_FIREBASE_APP_ID=1:1:web:test \
  npx next build > "$WORK/build.log" 2>&1 || { tail -30 "$WORK/build.log"; exit 1; }

# A server already on the port would be silently tested instead of ours.
if curl -sf -o /dev/null --max-time 2 "http://localhost:$PORT/map"; then
  echo "something is already serving :$PORT — refusing to test against it"
  exit 1
fi

echo "==> starting server on :$PORT"
FIREBASE_SERVICE_ACCOUNT_KEY="$SA_B64" \
CREW_UIDS="$NICK,$DANA" \
CRON_SECRET="test-cron-secret" \
FIRESTORE_EMULATOR_HOST="127.0.0.1:$FIRESTORE_PORT" \
FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:$AUTH_PORT" \
TWILIO_ACCOUNT_SID="ACfaketestaccountsid000000000000000" \
TWILIO_AUTH_TOKEN="faketoken" \
TWILIO_PHONE_NUMBER="+15025550100" \
  setsid npx next start -p "$PORT" > "$WORK/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 45); do
  curl -sf -o /dev/null "http://localhost:$PORT/map" && break
  sleep 1
done
curl -sf -o /dev/null "http://localhost:$PORT/map" || {
  echo "server failed to start:"; tail -20 "$WORK/server.log"; exit 1;
}

echo "==> running tests"
TEST_BASE_URL="http://localhost:$PORT" \
TEST_AUTH_EMULATOR="http://127.0.0.1:$AUTH_PORT/identitytoolkit.googleapis.com/v1" \
CRON_SECRET="test-cron-secret" \
  node --test tests/api.auth.test.mjs

# ---------------------------------------------------------------------------
# The half-configured deployment.
#
# Same build, same everything, minus FIREBASE_SERVICE_ACCOUNT_KEY. Worth its own
# server because the failure is indistinguishable from a bad token unless the
# route checks for it first, and "your session expired" sends whoever deployed
# it to look at their own login instead of at their hosting variables.
echo "==> starting an unconfigured server on :$UNCONFIGURED_PORT"
CREW_UIDS="$NICK,$DANA" \
CRON_SECRET="test-cron-secret" \
FIRESTORE_EMULATOR_HOST="127.0.0.1:$FIRESTORE_PORT" \
FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:$AUTH_PORT" \
TWILIO_ACCOUNT_SID="ACfaketestaccountsid000000000000000" \
TWILIO_AUTH_TOKEN="faketoken" \
TWILIO_PHONE_NUMBER="+15025550100" \
  setsid npx next start -p "$UNCONFIGURED_PORT" > "$WORK/bare.log" 2>&1 &
BARE_PID=$!

for _ in $(seq 1 45); do
  curl -sf -o /dev/null "http://localhost:$UNCONFIGURED_PORT/map" && break
  sleep 1
done
curl -sf -o /dev/null "http://localhost:$UNCONFIGURED_PORT/map" || {
  echo "unconfigured server failed to start:"; tail -20 "$WORK/bare.log"; exit 1;
}

echo "==> running unconfigured-deployment tests"
TEST_BASE_URL="http://localhost:$UNCONFIGURED_PORT" \
TEST_AUTH_EMULATOR="http://127.0.0.1:$AUTH_PORT/identitytoolkit.googleapis.com/v1" \
  node --test tests/api.unconfigured.test.mjs
