#!/usr/bin/env bash
# The only sanctioned path to production: build, unit gates, preview deploy,
# live gate against the preview, then production deploy, then the live gate again.
# Refuses a dirty tree unless SHIP_DIRTY=1 carries an incident reason.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ] && [ "${SHIP_DIRTY:-}" != "1" ]; then
  echo "REFUSED: dirty tree. Commit first, or SHIP_DIRTY=1 with an incident reason."; exit 1
fi
HEAD=$(git rev-parse HEAD)
echo "== build =="
npm run build
echo "== unit gates =="
npm run test:preview:unit
echo "== preview deploy =="
OUT=$(npx wrangler pages deploy dist --project-name=inksheaf --branch=ship-check --commit-hash="$HEAD" --commit-dirty=false 2>&1)
PREVIEW_URL=$(echo "$OUT" | grep -o 'https://[a-z0-9]*\.inksheaf\.pages\.dev' | head -1)
[ -n "$PREVIEW_URL" ] || { echo "no preview url"; echo "$OUT" | tail -3; exit 1; }
echo "preview: $PREVIEW_URL"
echo "== live gate against preview =="
INKSHEAF_BASE_URL="$PREVIEW_URL" node scripts/test-live-preview.mjs
echo "== production deploy =="
npx wrangler pages deploy dist --project-name=inksheaf --branch=main --commit-hash="$HEAD" --commit-dirty=false | tail -1
sleep 6
echo "== live gate against production =="
node scripts/test-live-preview.mjs
echo "SHIPPED $HEAD"
