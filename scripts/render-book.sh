#!/bin/bash
# Render a built book HTML to PDF via Paged.js + headless Chromium. Thin wrapper over
# scripts/render-book.mjs (node + the playwright package), so the same renderer runs on this
# Mac and on the Ubuntu runner; the old playwright-cli and macOS-only stat are gone.
# Refuses silent staleness: exits nonzero unless a fresh PDF with a page count came back.
# Usage: scripts/render-book.sh proofs/book.html proofs/book.pdf
set -u
HTML="$1"; PDF="$2"
OUT=$(node "$(dirname "$0")/render-book.mjs" "$HTML" "$PDF" 2>&1); RC=$?
PAGES=$(echo "$OUT" | grep -oE 'PAGES=[0-9]+' | head -1)
if [ "$RC" -ne 0 ] || [ -z "$PAGES" ]; then
  echo "RENDER FAILED (pages='$PAGES', rc=$RC)"
  echo "$OUT" | tail -8
  exit 1
fi
SIZE=$(wc -c < "$PDF" | tr -d ' ')
echo "OK ${PAGES#PAGES=} $(basename "$PDF") $SIZE bytes"
