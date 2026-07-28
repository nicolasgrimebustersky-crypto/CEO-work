#!/usr/bin/env bash
#
# Builds the static bundle and syncs it into the iOS project.
#
#   npm run ios:build      # build + sync
#   npm run ios:open       # build + sync + open Xcode
#
# Requires macOS with Xcode and CocoaPods for the `cap sync` step. Everything
# before that runs anywhere.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${NEXT_PUBLIC_API_BASE_URL:-}" ]] && ! grep -q '^NEXT_PUBLIC_API_BASE_URL=.\+' .env.local 2>/dev/null; then
  cat >&2 <<'MSG'
NEXT_PUBLIC_API_BASE_URL is not set.

The native bundle has no API routes of its own — it calls the deployed ones.
Without this the app builds, but sending a text or a blast fails with a
"not found" that is hard to trace back to here.

Set it in .env.local, e.g.
  NEXT_PUBLIC_API_BASE_URL=https://grimebusters.vercel.app
MSG
  exit 1
fi

# next-pwa writes these into public/ during a web build. They would then be
# copied into the app bundle, where a service worker caching the local files
# against themselves makes app updates behave unpredictably.
echo "==> clearing service worker artifacts"
rm -f public/sw.js public/sw.js.map public/workbox-*.js public/workbox-*.js.map public/fallback-*.js

echo "==> building static export"
rm -rf out
BUILD_TARGET=native npx next build

if [[ ! -f out/index.html ]]; then
  echo "static export produced no out/index.html" >&2
  exit 1
fi

# Belt and braces: nothing server-side should ever reach the bundle.
if find out -name "*.api.*" -o -path "*/api/*" | grep -q .; then
  echo "API artifacts leaked into the static bundle — refusing to sync" >&2
  find out -name "*.api.*" -o -path "*/api/*" >&2
  exit 1
fi

echo "==> static bundle ready ($(find out -type f | wc -l | tr -d ' ') files)"

if ! command -v xcodebuild >/dev/null 2>&1; then
  cat <<'MSG'

Bundle built, but this machine has no Xcode, so the iOS project was not synced.
Run the rest on a Mac:

  npx cap add ios     # first time only
  npx cap sync ios
  npx cap open ios

MSG
  exit 0
fi

if [[ ! -d ios ]]; then
  echo "==> adding iOS platform"
  npx cap add ios
fi

echo "==> syncing to iOS"
npx cap sync ios

if [[ "${1:-}" == "--open" ]]; then
  npx cap open ios
fi
