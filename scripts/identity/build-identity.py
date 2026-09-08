from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
import json
root=Path(__file__).resolve().parents[2]
font=TTFont(root/'public/fonts/book-18.woff2')
marks={
 'folio':'<g fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="miter"><path d="M15 4 37 10v29l-22-6Z"/><path d="M9 10v29l22 6M3 16v29l22 6"/></g>',
 'gather':'<g fill="currentColor"><path d="m3 9 8-3 10 25v13h-6V32Zm20-7h6v42h-6Zm21 7-8-3-5 14v17Z"/><path d="M13 46h22v4H13Z"/></g>',
 'wordmark':''
}
records=[]
for variant,weight in [('folio',600),('gather',580),('wordmark',650)]:
 f=instantiateVariableFont(font,{'wght':weight},inplace=False);gs=f.getGlyphSet();cmap=f.getBestCmap();x=0;parts=[];bounds=[]
 tracking=-6 if variant!='wordmark' else 1
 for char in 'inksheaf':
  glyph=gs[cmap[ord(char)]];pen=SVGPathPen(gs);glyph.draw(TransformPen(pen,(1,0,0,-1,x,760)));parts.append('<path d="'+pen.getCommands()+'"/>');x+=glyph.width+tracking
 paths='<g fill="currentColor">'+''.join(parts)+'</g>'
 # Outlined source with optically opened spacing: browser font loading cannot alter the identity.
 word=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {x+6} 820" role="img" aria-label="Inksheaf">{paths}</svg>'
 (root/f'public/brand/identity/{variant}-wordmark.svg').write_text(word)
 if marks[variant]:(root/f'public/brand/identity/{variant}-mark.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 54" role="img" aria-label="Inksheaf">'+marks[variant]+'</svg>')
 records.append({'name':variant,'weight':weight,'wordmark_width':x+6,'wordmark_height':820})
(root/'output/identity/type-spec.json').write_text(json.dumps(records,indent=2))
print('Created three outlined identity directions from OFL Source Serif 4.')

# Production masters. Bounds come from actual ink, including the terminal f overhang.
full=TTFont(root/'fonts/SourceSerif4[opsz,wght].ttf')
for name,weight,opsz,tracking in [('wordmark',630,36,-9),('wordmark-small',650,14,12),('wordmark-reverse',600,36,-6),('wordmark-small-reverse',620,14,14)]:
 f=instantiateVariableFont(full,{'wght':weight,'opsz':opsz},inplace=False);gs=f.getGlyphSet();cmap=f.getBestCmap();parts=[];x=0;ink=[]
 pairs={'in':17,'nk':-8,'ks':-6,'sh':-13,'he':-5,'ea':-9,'af':17}
 for i,char in enumerate('inksheaf'):
  glyph=gs[cmap[ord(char)]];bp=BoundsPen(gs);glyph.draw(TransformPen(bp,(1,0,0,-1,x,0)));ink.append(bp.bounds)
  pen=SVGPathPen(gs);glyph.draw(TransformPen(pen,(1,0,0,-1,x,0)));parts.append('<path d="'+pen.getCommands()+'"/>')
  x+=glyph.width+tracking+pairs.get('inksheaf'[i:i+2],0)
 left=min(b[0] for b in ink)-28;top=min(b[1] for b in ink)-28;right=max(b[2] for b in ink)+55;bottom=max(b[3] for b in ink)+28
 svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{left} {top} {right-left} {bottom-top}" role="img" aria-label="Inksheaf"><g fill="currentColor">'+''.join(parts)+'</g></svg>'
 (root/f'public/brand/{name}.svg').write_text(svg)
# A compact, type-derived printer's i. No fine wheat engraving in the small icon.
f=instantiateVariableFont(full,{'wght':700,'opsz':12},inplace=False);gs=f.getGlyphSet();glyph=gs[f.getBestCmap()[ord('i')]];bp=BoundsPen(gs);glyph.draw(bp);x0,y0,x1,y1=bp.bounds
scale=46/(y1-y0);pen=SVGPathPen(gs);glyph.draw(TransformPen(pen,(scale,0,0,-scale,32-(x0+x1)*scale/2,9+y1*scale)))
(root/'public/brand/mark.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Inksheaf"><path fill="currentColor" d="'+pen.getCommands()+'"/></svg>')
(root/'public/favicon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#20231f"/><path fill="#f5f3ec" d="'+pen.getCommands()+'"/></svg>')
print('Production wordmark: optical large/small/reversed masters and type-derived favicon.')
