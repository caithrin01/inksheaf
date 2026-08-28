#!/bin/bash
# Render a built book HTML to PDF via Paged.js + playwright. Refuses silent staleness:
# exits nonzero unless the PDF mtime is newer than invocation time.
# Usage: scripts/render-book.sh proofs/book.html proofs/book.pdf
set -u
HTML="$1"; PDF="$2"
DIR="$(cd "$(dirname "$HTML")" && pwd)"; BASE="$(basename "$HTML")"
PORT=$(( 9100 + RANDOM % 400 ))
START=$(date +%s)
cd "$DIR" && nohup python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
sleep 1
playwright-cli open about:blank >/dev/null 2>&1
OUT=$(playwright-cli run-code "async page => {
  await page.goto('http://127.0.0.1:$PORT/$BASE?v=' + Date.now(), {waitUntil:'domcontentloaded'});
  const n = await page.evaluate(() => Promise.race([window.__pagedDone, new Promise((_,rej)=>setTimeout(()=>rej(new Error('paged timeout')), 300000))]));
  await page.waitForTimeout(4000);
  await page.pdf({ path: '$PDF', preferCSSPageSize: true, printBackground: true });
  return 'PAGES=' + n;
}" 2>&1)
playwright-cli close >/dev/null 2>&1
kill $SRV 2>/dev/null
PAGES=$(echo "$OUT" | grep -oE 'PAGES=[0-9]+' | head -1)
MT=$(stat -f %m "$PDF" 2>/dev/null || echo 0)
if [ -z "$PAGES" ] || [ "$MT" -lt "$START" ]; then
  echo "RENDER FAILED (pages='$PAGES', fresh=$([ "$MT" -ge "$START" ] && echo yes || echo no))"
  echo "$OUT" | tail -5
  exit 1
fi
echo "OK $PAGES $(basename "$PDF") $(stat -f %z "$PDF") bytes"
