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
  # --ignore-system-fonts so the render uses ONLY the repo's fonts/, identical on a Mac and on CI;
  # otherwise a Mac silently borrows a system CJK font and hides a missing-font bug that tofus on CI.
  OUT=$(typst compile --root "$HERE" --font-path "$HERE/fonts" --ignore-system-fonts "$TYP" "$PDF" 2>&1); RC=$?
  if [ "$RC" -ne 0 ]; then echo "RENDER FAILED (typst rc=$RC)"; echo "$OUT" | grep -v "^warning: unknown font" | tail -12; exit 1; fi
  # Bind complete leaves. Pad the compiled file (not a self-referential Typst page query)
  # so pagination and all source anchors stay stable, and Lulu sees the exact quoted count.
  node --input-type=module -e '
    import {readFileSync,writeFileSync,existsSync} from "node:fs";
    import {PDFDocument} from "pdf-lib";
    const [pdf,report]=process.argv.slice(1);
    const meta=existsSync(report)?JSON.parse(readFileSync(report,"utf8")):{};
    if(meta.printInterior){const doc=await PDFDocument.load(readFileSync(pdf));if(doc.getPageCount()%2){
      const {width,height}=doc.getPage(0).getSize();doc.addPage([width,height]);
      writeFileSync(pdf,await doc.save());console.log("Added blank binding verso.");}}
  ' "$PDF" "${HTML%.html}.report.json" || { echo "RENDER FAILED (binding parity)"; exit 1; }
  # tofu gate: Typst emits no warning for uncovered glyphs and the blank gate cannot see a box, so
  # scan the PDF for missing glyphs (glyph id 0). Catches CJK/accented text with no covering font.
  TOFU=$(python3 "$HERE/scripts/tofu-check.py" "$PDF" 2>&1); TRC=$?
  if [ "$TRC" -ne 0 ]; then echo "RENDER FAILED (tofu)"; echo "$TOFU" | tail -4; exit 1; fi
  PAGES=$(node -e 'const {PDFDocument}=require("pdf-lib");PDFDocument.load(require("fs").readFileSync(process.argv[1])).then(d=>console.log(d.getPageCount()))' "$PDF")
  MAP=$(typst query --root "$HERE" --font-path "$HERE/fonts" "$TYP" "<artstart>" --field value 2>/dev/null); ENDS=$(typst query --root "$HERE" --font-path "$HERE/fonts" "$TYP" "<artend>" --field value 2>/dev/null)
  PARTS=$(typst query --root "$HERE" --font-path "$HERE/fonts" "$TYP" "<partstart>" --field value 2>/dev/null)
  FOLIOS=$(typst query --root "$HERE" --font-path "$HERE/fonts" "$TYP" "<folio>" --field value 2>/dev/null)
  SKIP=$(node -e '
    const s=JSON.parse(process.argv[1]||"[]"), e=JSON.parse(process.argv[2]||"[]"), n=+process.argv[3];
    const skip=new Set(); const first=s.length?Math.min(...s.map(x=>x.page)):1; const last=e.length?Math.max(...e.map(x=>x.page)):n;
    for(let p=1;p<first;p++) skip.add(p); for(let p=last+1;p<=n;p++) skip.add(p);
    for(const x of e) skip.add(x.page);            /* closers */
    for(const x of s) skip.add(x.page);            /* openers: chapter number, title and subtitle sit low by design, so a short article ends its opener airy (this is typography, not a dropped image; mid-article figure gaps are not openers and stay caught) */
    for(const x of JSON.parse(process.argv[4]||"[]")) {
      skip.add(x.page); /* measured section-divider leaves */
      const prev=x.page-1;
      if(prev>=1&&!s.some(a=>a.page<=prev&&(e.find(b=>b.n===a.n)?.page??a.page)>=prev))skip.add(prev); /* blank verso before a recto divider */
    }
    for(const x of s){ const prev=x.page-1; if(prev>=1 && !e.some(y=>y.page===prev) && !s.some(y=>y.page===prev)) skip.add(prev); } /* part pages before an opener */
    console.log([...skip].sort((a,b)=>a-b).join(","));' "$MAP" "$ENDS" "$PAGES" "$PARTS")
  BL=$(python3 "$HERE/scripts/blank-measure.py" "$PDF" --limit "${BLANK_MAX:-0.40}" --skip "$SKIP" --json "${PDF%.pdf}.pages.json" 2>&1); BRC=$?
  echo "$BL"
  # Account for all unused vertical intervals, not only the largest/trailing gap.
  # This records every page, including structural leaves and article endings.
  python3 "$HERE/scripts/pdf-whitespace-audit.py" "$PDF" --out "${PDF%.pdf}.whitespace.json" >/dev/null || { echo "RENDER FAILED (whitespace measurement)"; exit 1; }
  # for each short page, the first figure on the next page and the height that was left: the fit
  # loop rebuilds with --fit-figs so that figure sits in flow at that height (engine: typst)
  FIGS=$(typst query --root "$HERE" --font-path "$HERE/fonts" "$TYP" "<fig>" --field value 2>/dev/null)
  LINKS=$(typst query --root "$HERE" --font-path "$HERE/fonts" "$TYP" "<linkstart>" --field value 2>/dev/null)
  PAR_STARTS=$(typst query --root "$HERE" --font-path "$HERE/fonts" "$TYP" "<parstart>" --field value 2>/dev/null)
  PAR_ENDS=$(typst query --root "$HERE" --font-path "$HERE/fonts" "$TYP" "<parend>" --field value 2>/dev/null)
  node -e '
    const fs=require("fs"); const f=process.argv[1]; const d=JSON.parse(fs.readFileSync(f,"utf8")); const figs=JSON.parse(process.argv[2]||"[]"); const ends=JSON.parse(process.argv[3]||"[]");
    const TEXT_H=7.44; d.engine="typst"; d.fit=[]; d.tail=[];
    const starts=JSON.parse(process.argv[4]||"[]");
    d.articles=starts.map(s=>({n:s.n,start:s.page,end:ends.find(e=>e.n===s.n)?.page||s.page}));
    d.linkStarts=JSON.parse(process.argv[5]||"[]");
    d.parts=JSON.parse(process.argv[6]||"[]");
    d.folios=JSON.parse(process.argv[7]||"[]");
    d.figures=figs;
    const ps=JSON.parse(process.argv[8]||"[]"),pe=JSON.parse(process.argv[9]||"[]");
    d.paragraphs=ps.map(s=>({id:s.id,start:s,end:pe.find(e=>e.id===s.id)}));
    const spacing=JSON.parse(fs.readFileSync(f.replace(/\.pages\.json$/,".whitespace.json"),"utf8"));
    if(spacing.pages.length!==d.pages.length)throw Error("Whitespace measurement omitted pages");
    d.whitespace_metric=spacing.metric;
    for(const p of d.pages){const s=spacing.pages.find(s=>s.page===p.page);if(!s||!Number.isFinite(s.unused))throw Error("Whitespace measurement missing");p.unused=s.unused;}
    /* short body pages: the figure that fell onto the next page is scaled to the space left, less
       1.2in for figure spacing and a subheading that may stick to it */
    for (const b of d.bad) { const nx=figs.find(x=>x.page===b.page+1); if (!nx) continue;
      const h=Math.max(1.2, Math.round((b.blank*TEXT_H-1.2)*100)/100); d.fit.push({ page:b.page, id:nx.id, height:h }); }
    /* An opener is not automatically allowed a half-empty lower page. Fit its first
       picture into that space when the result remains at least two inches tall. */
    for(const a of d.articles){const pg=d.pages[a.start-1];if(!pg||pg.blank<=.30||a.end<=a.start)continue;
      const fig=figs.find(f=>f.page===a.start+1);if(!fig||d.fit.some(f=>f.id===fig.id))continue;
      // Reserve space for the caption and figure margins, not just the image itself.
      const height=Math.round(Math.min(pg.blank*TEXT_H-1, (fig.h||0)/72-.15)*100)/100;
      if(height>=2 && height<(fig.h||0)/72-.1)d.fit.push({page:a.start,id:fig.id,height,opener:true});}
    /* one rule for how an essay ends. Its tail is whatever sits on its last page when that page
       holds little (a quarter of the text block or less): a figure alone, a note alone, a line and
       a figure. The essay'"'"'s last figure is scaled so the tail fits on the page before, using the
       figure'"'"'s own height from Typst and the free space measured on the page before. If the figure
       would end up under 1.4in it is left alone: a small plate page beats a postage stamp. */
    for (const e of ends) { const pg=d.pages[e.page-1], prev=d.pages[e.page-2]; if (!pg||!prev||pg.ink_rows>0.5) continue;
      const fig=[...figs].reverse().find(x=>x.page===e.page||x.page===e.page-1); if (!fig||d.fit.some(x=>x.id===fig.id)) continue;
      const figH=(fig.h||0)/72, onCloser=fig.page===e.page;
      if (pg.ink_rows>0.25 && !onCloser) continue; /* a substantial text ending is not a figure orphan */
      const closerNeeds=pg.ink_rows*TEXT_H+0.3, prevFree=prev.blank*TEXT_H;
      const need = onCloser ? closerNeeds - prevFree : closerNeeds - prevFree; /* what must be freed on the page before */
      if (need <= 0.05) continue; /* the tail already has room on the page before; scaling would change nothing */
      const newH = Math.round((figH - need - 0.15)*100)/100;
      d.tail.push({ page:e.page, id:fig.id, figH:Math.round(figH*100)/100, onCloser, prevFree:Math.round(prevFree*100)/100, closerNeeds:Math.round(closerNeeds*100)/100, newH });
      if (newH >= 1.4 && newH < figH - 0.05) d.fit.push({ page:e.page-1, id:fig.id, height:newH, closer:true }); }
    /* A tiny final nutrition panel cannot be shrunk usefully. A preceding photograph
       may instead give back the space needed by that panel or a few final lines.
       Keep readable diagrams intact and retain at least a two-inch photograph. */
    for(const a of d.articles){const pg=d.pages[a.end-1],prev=d.pages[a.end-2];
      if(!pg||!prev||a.end<=a.start||pg.ink_rows>=.25||d.fit.some(f=>f.page>=a.start&&f.page<a.end))continue;
      const choices=figs.filter(f=>f.page>=a.start&&f.page<a.end&&f.page>=a.end-3&&f.role!=="reading"&&(f.h||0)/72>2.2);
      const fig=choices.sort((x,y)=>y.h-x.h)[0];if(!fig)continue;
      const needed=Math.max(.3,pg.ink_rows*TEXT_H+.45-prev.blank*TEXT_H);
      const height=Math.round(Math.max(2,fig.h/72-needed)*100)/100;
      if(height<fig.h/72-.1)d.fit.push({page:fig.page,id:fig.id,height,closer:true});}
    if (d.tail.length) console.log("TAIL " + d.tail.map(t=>`p${t.page} ${t.id} ${t.figH}in ${t.newH>=1.4?"-> "+t.newH+"in":"kept"}`).join("; "));
    fs.writeFileSync(f, JSON.stringify(d));' "${PDF%.pdf}.pages.json" "$FIGS" "$ENDS" "$MAP" "$LINKS" "$PARTS" "$FOLIOS" "$PAR_STARTS" "$PAR_ENDS"
  # tails are recorded for the fit loop, never a failure here: only the blank gate fails a render
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
