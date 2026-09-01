#!/usr/bin/env bash
# The only sanctioned path to production. Every step must pass before the production
# deploy; nothing else in this repo may run `wrangler pages deploy`.
#
#   clean tree -> build -> validate.py -> unit -> renderer (no render) -> honesty (local)
#   -> dist privacy scan -> preview deploy -> FRESH cold-origin gate -> journeys -> inputs
#   -> honesty (preview) -> production deploy -> live gate + journeys against production
#
# Refuses a dirty tree unless SHIP_DIRTY=1 and SHIP_REASON="why" are both set; the reason
# is printed into the log so an incident deploy is never silent.
# SKIP_BROWSER=1 skips the Playwright suites (only for a documented hotfix of the gate itself).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  if [ "${SHIP_DIRTY:-}" != "1" ] || [ -z "${SHIP_REASON:-}" ]; then
    echo "REFUSED: dirty tree. Commit first, or SHIP_DIRTY=1 SHIP_REASON=\"incident: ...\""; exit 1
  fi
  echo "DIRTY DEPLOY, reason: $SHIP_REASON"
fi
HEAD=$(git rev-parse HEAD)
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "ship $HEAD at $STAMP"

step() { echo; echo "== $1 =="; }

step "build";            npm run build
step "validate.py";      python3 validate.py
step "unit gates";       npm run test:preview:unit
step "renderer contract"; node scripts/test-renderer.mjs --skip-render
step "honesty (source)"; node scripts/test-honesty.mjs --source-only

step "dist privacy scan"
FORBIDDEN=$(find dist -type f \( -name '*.pdf' -o -path 'dist/evidence/*' -o -path 'dist/proofs/*' \) | head -20 || true)
if [ -n "$FORBIDDEN" ]; then echo "REFUSED: forbidden artifacts in dist:"; echo "$FORBIDDEN"; exit 1; fi
echo "dist clean: no PDFs, no evidence, no proofs"

step "preview deploy"
OUT=$(npx wrangler pages deploy dist --project-name=inksheaf --branch=ship-check --commit-hash="$HEAD" --commit-dirty="${SHIP_DIRTY:-false}" 2>&1)
PREVIEW_URL=$(echo "$OUT" | grep -o 'https://[a-z0-9]*\.inksheaf\.pages\.dev' | head -1)
[ -n "$PREVIEW_URL" ] || { echo "no preview url"; echo "$OUT" | tail -3; exit 1; }
echo "preview: $PREVIEW_URL"
sleep 4

step "cold-origin gate against preview (FRESH=1: clears the four gate hosts from cache)"
FRESH=1 INKSHEAF_BASE_URL="$PREVIEW_URL" node scripts/test-live-preview.mjs

if [ "${SKIP_BROWSER:-}" != "1" ]; then
  step "journeys against preview (chromium)"; node scripts/test-journeys.mjs chromium "$PREVIEW_URL"
  step "hostile inputs against preview";       node scripts/test-inputs.mjs chromium "$PREVIEW_URL"
fi
step "honesty against preview"; node scripts/test-honesty.mjs "$PREVIEW_URL"

step "production deploy"
npx wrangler pages deploy dist --project-name=inksheaf --branch=main --commit-hash="$HEAD" --commit-dirty="${SHIP_DIRTY:-false}" | tail -1
sleep 6

step "live gate against production"; node scripts/test-live-preview.mjs
if [ "${SKIP_BROWSER:-}" != "1" ]; then
  step "journeys against production (chromium)"; node scripts/test-journeys.mjs chromium
fi
step "honesty against production"; node scripts/test-honesty.mjs

echo
echo "SHIPPED $HEAD at $STAMP via $PREVIEW_URL"
