#!/bin/bash
# Teaser assets A4-A6, A10: covers, interior pages, imposition — pulled from the proof PDFs
# at 300dpi (the PDFs are the artifact of record; nothing is restaged).
# Output: assets/shots/<slug>.png  (masters; pairing into spreads happens here too)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=assets/shots
mkdir -p "$OUT"

pull() { # pull <pdf> <page> <name>
  pdftoppm -f "$2" -l "$2" -r 300 -png "proofs/$1" "$OUT/tmp-$3" && mv "$OUT/tmp-$3"-*.png "$OUT/$3.png"
}

# A4/A5 covers (page 1 of each proof)
pull caithrin-annual-proof.pdf    1 cover-caithrin
pull caithrin-selected-proof.pdf  1 cover-caithrin-selected
pull hcr-proof.pdf                1 cover-hcr
pull razib-proof.pdf              1 cover-razib
pull slowboring-proof.pdf         1 cover-slowboring

# A6 interior candidates from the caithrin annual (picked on the contact sheet)
for p in 2 3 4 5 6 7 8 9 10 11 12; do pull caithrin-annual-proof.pdf $p caithrin-p$(printf %02d $p); done
# comments appendix + get-more live near the end
LAST=$(pdfinfo proofs/caithrin-annual-proof.pdf | awk '/^Pages/{print $2}')
for i in 0 1 2 3 4; do p=$((LAST-i)); pull caithrin-annual-proof.pdf $p caithrin-end$(printf %02d $i); done

# letters kind: month-part TOC from the letters fixture proof if present
[ -f proofs/letters-proof.pdf ] && for p in 2 3 4; do pull letters-proof.pdf $p letters-p$p; done || true

# A10 imposition: first booklet sheet + a mid spread
pull caithrin-annual-proof-booklet.pdf 1 impose-booklet-sheet1
MID=$(pdfinfo proofs/caithrin-annual-proof-spreads.pdf | awk '/^Pages/{print int($2/2)}')
pull caithrin-annual-proof-spreads.pdf $MID impose-spread-mid

# pair single pages into open-book spreads (verso|recto): TOC-ish and opener-ish pairs
spread() { magick "$OUT/$2.png" "$OUT/$3.png" +append -bordercolor '#efe8d8' -border 40 "$OUT/spread-$1.png"; }
spread toc     caithrin-p04 caithrin-p05
spread opener  caithrin-p08 caithrin-p09
spread opener2 caithrin-p10 caithrin-p11
echo "pdf pulls complete:"; ls "$OUT" | wc -l
