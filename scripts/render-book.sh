#!/bin/bash
# Render a built book to PDF. Two engines:
#   paged (default): scripts/render-book.mjs, Paged.js in headless Chromium, with the DOM
#     blank-page detector and the fit loop's defer hints.
#   typst (BOOK_ENGINE=typst, or a .typ beside the .html written by build-book --engine typst):
#     `typst compile` with the repo's fonts, then the raster blank measure with front matter,
#     part pages and each article's last page exempt (page map from the emitter's metadata).
# Refuses silent staleness: exits nonzero unless a fresh PDF with a page count came back.
# Usage: scripts/render-book.sh proofs/book.html proofs/book.pdf
set -u
HTML="$1"; PDF="$2"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TYP="${HTML%.html}.typ"
if [ "${BOOK_ENGINE:-paged}" = "typst" ] && [ -f "$TYP" ]; then
  START=$(date +%s)
  OUT=$(typst compile --font-path "$HERE/fonts" "$TYP" "$PDF" 2>&1); RC=$?
  if [ "$RC" -ne 0 ]; then echo "RENDER FAILED (typst rc=$RC)"; echo "$OUT" | grep -v "^warning: unknown font" | tail -12; exit 1; fi
  PAGES=$(node -e 'const {PDFDocument}=require("pdf-lib");PDFDocument.load(require("fs").readFileSync(process.argv[1])).then(d=>console.log(d.getPageCount()))' "$PDF")
  MAP=$(typst query --font-path "$HERE/fonts" "$TYP" "<artstart>" --field value 2>/dev/null); ENDS=$(typst query --font-path "$HERE/fonts" "$TYP" "<artend>" --field value 2>/dev/null)
  SKIP=$(node -e '
    const s=JSON.parse(process.argv[1]||"[]"), e=JSON.parse(process.argv[2]||"[]"), n=+process.argv[3];
    const skip=new Set(); const first=s.length?Math.min(...s.map(x=>x.page)):1; const last=e.length?Math.max(...e.map(x=>x.page)):n;
    for(let p=1;p<first;p++) skip.add(p); for(let p=last+1;p<=n;p++) skip.add(p);
    for(const x of e) skip.add(x.page);            /* closers */
    for(const x of s){ const prev=x.page-1; if(prev>=1 && !e.some(y=>y.page===prev) && !s.some(y=>y.page===prev)) skip.add(prev); } /* part pages before an opener */
    console.log([...skip].sort((a,b)=>a-b).join(","));' "$MAP" "$ENDS" "$PAGES")
  BL=$(python3 "$HERE/scripts/blank-measure.py" "$PDF" --limit "${BLANK_MAX:-0.40}" --skip "$SKIP" --json "${PDF%.pdf}.pages.json" 2>&1); BRC=$?
  echo "$BL"
  if [ "$BRC" -ne 0 ] && [ "${BLANK_PAGES:-fail}" != "warn" ]; then echo "RENDER FAILED (blank pages)"; exit 1; fi
  SIZE=$(wc -c < "$PDF" | tr -d ' ')
  echo "OK $PAGES $(basename "$PDF") $SIZE bytes typst $(( $(date +%s) - START ))s"
  exit 0
fi
OUT=$(node "$HERE/scripts/render-book.mjs" "$HTML" "$PDF" 2>&1); RC=$?
PAGES=$(echo "$OUT" | grep -oE 'PAGES=[0-9]+' | head -1)
if [ "$RC" -ne 0 ] || [ -z "$PAGES" ]; then
  echo "RENDER FAILED (pages='$PAGES', rc=$RC)"
  echo "$OUT" | tail -8
  exit 1
fi
SIZE=$(wc -c < "$PDF" | tr -d ' ')
echo "OK ${PAGES#PAGES=} $(basename "$PDF") $SIZE bytes"
