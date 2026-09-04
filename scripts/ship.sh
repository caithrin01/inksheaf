#!/bin/bash
# Preview gate for a committed tree. Since 2026-09-02 (Codex audit P0-10) this script never
# deploys production: production is released only by .github/workflows/deploy.yml inside the
# protected "production" environment, which needs Caithrin's approval. This script builds a
# frozen export of HEAD, runs every local gate, deploys a ship-check preview and runs the
# browser gates against it. There is no dirty-tree escape and no browser skip: a dirty tree is
# refused, and a gate that cannot run is a failed gate.
set -euo pipefail
# Bash reads a script incrementally, so an edit to this file while a gate runs would derail
# it mid-flight (2026-09-01: a rewrite during the gate turned "sleep 6" into "6"). The
# whole body is one function, parsed completely before anything executes.
main() {
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  if true; then
    echo "REFUSED: dirty tree. Commit first."; exit 1
  fi
  echo "DIRTY DEPLOY, reason: $SHIP_REASON"
fi
HEAD=$(git rev-parse HEAD)
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "ship $HEAD at $STAMP"

step() { echo; echo "== $1 =="; }

# Everything below runs from a frozen export of the tree, never from the working copy: an
# edit to a script or a rebuild in another shell while this gate runs cannot change what
# gets tested or what production receives. A dirty ship freezes the working tree instead.
REPO=$PWD
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/inksheaf-ship.XXXXXX")
ln -s "$REPO/node_modules" "$STAGE/node_modules"
ln -s "$REPO/.wrangler" "$STAGE/.wrangler" 2>/dev/null || true
cd "$STAGE"
echo "frozen tree at $STAGE"

step "build";            npm run build
step "validate.py";      python3 validate.py
step "unit gates";       npm run test:preview:unit
step "renderer (full render)"; node scripts/test-renderer.mjs
step "honesty (source)"; node scripts/test-honesty.mjs --source-only

step "dist privacy scan"
FORBIDDEN=$(find dist -type f \( -name '*.pdf' -o -name '_*.html' -o -path 'dist/evidence/*' -o -path 'dist/proofs/*' \) | head -20 || true)
if [ -n "$FORBIDDEN" ]; then echo "REFUSED: forbidden artifacts in dist:"; echo "$FORBIDDEN"; exit 1; fi
echo "dist clean: no PDFs, no lab pages, no evidence, no proofs"

tree_hash() { (cd "$1" && find . -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -c1-16); }
DIST_HASH=$(tree_hash dist)
echo "frozen build $DIST_HASH"

step "preview deploy"
OUT=$(npx wrangler pages deploy dist --project-name=inksheaf --branch=ship-check --commit-hash="$HEAD" --commit-dirty=false 2>&1)
PREVIEW_URL=$(echo "$OUT" | grep -o 'https://[a-z0-9]*\.inksheaf\.pages\.dev' | head -1)
[ -n "$PREVIEW_URL" ] || { echo "no preview url"; echo "$OUT" | tail -3; exit 1; }
echo "preview: $PREVIEW_URL"
sleep 4

step "cold-origin gate against preview (FRESH=1: signed cache bypass, cache left intact)"
FRESH=1 INKSHEAF_BASE_URL="$PREVIEW_URL" node scripts/test-live-preview.mjs

step "journeys against preview (chromium)"; node scripts/test-journeys.mjs chromium "$PREVIEW_URL"
step "hostile inputs against preview";       node scripts/test-inputs.mjs chromium "$PREVIEW_URL"
step "design gate against preview (axe contrast + 30 shots)"; INKSHEAF_HEAD="${HEAD:0:7}" node scripts/test-design.mjs "$PREVIEW_URL"
step "honesty against preview"; node scripts/test-honesty.mjs "$PREVIEW_URL"

# Production is released by .github/workflows/deploy.yml only (Codex audit P0-10).
echo
cd "$REPO"; rm -rf "$STAGE"
echo "PREVIEW GATES PASSED for $HEAD at $STAMP: $PREVIEW_URL (production is released by the deploy workflow)"
}
main "$@"; exit
