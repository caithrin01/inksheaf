#!/bin/bash
# Present-back gate. Derived from the vault's incident taxonomy (last 30 days):
#  - claims without evidence  -> this script's output IS the evidence manifest
#  - shipped without rendering -> every book PDF must be newer than its HTML (stale = fail)
#  - sample-verified, batch-changed -> the full suite reruns here, not a remembered green
#  - frozen specs silently edited -> fixtures are hash-frozen; changes need a dated log line
# Exit 0 = presentable. Run before ANY "done" message to Caithrin.
set -u
cd "$(dirname "$0")/.."
FAIL=0
say() { printf '%s\n' "$*"; }

say "== suite =="
if node scripts/test-renderer.mjs --skip-render 2>&1 | tail -1 | grep -q " 0 fail"; then
  say "suite: static green"
else say "suite: FAIL"; FAIL=1; fi

say "== fixture freeze =="
SUM=$(shasum proofs/torture-fixture.json proofs/letters-fixture.json proofs/recipes-fixture.json 2>/dev/null | shasum | cut -c1-16)
if [ -f proofs/fixtures.sha ]; then
  OLD=$(cut -d' ' -f1 proofs/fixtures.sha)
  if [ "$SUM" != "$OLD" ]; then
    if grep -q "$SUM" proofs/fixtures.log 2>/dev/null; then say "fixtures: changed WITH log entry"
    else say "fixtures: CHANGED WITHOUT LOG (add dated line to proofs/fixtures.log, then update sha)"; FAIL=1; fi
  else say "fixtures: frozen, unchanged"; fi
else say "fixtures: baseline recorded"; fi
echo "$SUM  $(date +%F)" > proofs/fixtures.sha

say "== books: lint + render freshness =="
for html in proofs/caithrin-annual.html proofs/hcr.html proofs/slowboring.html proofs/caithrin-selected.html proofs/razib.html; do
  [ -f "$html" ] || continue
  base="${html%.html}"
  if node scripts/proof-lint.mjs "$html" >/dev/null 2>&1; then lint=ok; else lint=FAIL; FAIL=1; fi
  pdf=""
  for c in "${base}-proof.pdf" "${base/proofs\//proofs/}.pdf"; do [ -f "$c" ] && pdf="$c"; done
  fresh="NO-PDF(render before presenting)"
  if [ -n "$pdf" ]; then
    if [ "$pdf" -nt "$html" ]; then fresh="fresh"; else fresh="STALE(render before presenting)"; FAIL=1; fi
  else FAIL=1; fi
  pages=$(grep -c 'class="article" id="art-' "$html")
  say "$(basename "$html"): lint=$lint articles=$pages pdf=${pdf:-none} [$fresh]"
done

say "== vault validator =="
if python3 validate.py --quiet 2>/dev/null | grep -q " 0 fail"; then say "validator: green"
else say "validator: FAIL"; FAIL=1; fi

say ""
[ $FAIL -eq 0 ] && say "PRESENTABLE" || say "NOT PRESENTABLE"
exit $FAIL
