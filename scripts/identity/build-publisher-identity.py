"""Outlined identity. OFL Inter basis; redrawn i/k and optical spacing."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
ROOT=Path(__file__).resolve().parents[2]
font=TTFont(ROOT/'public/fonts/book-6.woff2')
for name,weight,tracking in [('wordmark',800,-31),('wordmark-small',790,0),('wordmark-reverse',780,-25),('wordmark-small-reverse',770,8)]:
 f=instantiateVariableFont(font,{'wght':weight},inplace=False);gs=f.getGlyphSet();cmap=f.getBestCmap();x=0;parts=[];bounds=[]
 for index,c in enumerate('inksheaf'):
  glyph=gs[cmap[ord(c)]]
  if c=='i':
   parts.append(f'<path transform="translate({x} 0)" d="M116 0h338v-1118H116ZM116-1252h338v-338H116Z"/>');b=(x+116,-1590,x+454,0)
  elif c=='k':
   parts.append(f'<path transform="translate({x} 0)" d="M115 0v-1490h333v881l355-509h392L764-562 1230 0H823L448-488V0Z"/>');b=(x+115,-1490,x+1230,0)
  else:
   pen=SVGPathPen(gs);glyph.draw(TransformPen(pen,(1,0,0,-1,x,0)));parts.append('<path d="'+pen.getCommands()+'"/>');bp=BoundsPen(gs);glyph.draw(TransformPen(bp,(1,0,0,-1,x,0)));b=bp.bounds
  bounds.append(b);pairs={'in':-12,'nk':-26,'ks':17,'sh':-18,'he':-5,'ea':14,'af':8};x+=glyph.width+tracking+pairs.get('inksheaf'[index:index+2],0)
 l=min(b[0] for b in bounds)-25;t=min(b[1] for b in bounds)-30;r=max(b[2] for b in bounds)+35;bt=max(b[3] for b in bounds)+30
 (ROOT/f'design/style-guide/assets/{name}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{l} {t} {r-l} {bt-t}" role="img" aria-label="Inksheaf"><g fill="currentColor">'+''.join(parts)+'</g></svg>')
mark='<path d="M23 9h18v16H23Zm0 22h18v24H23Z"/>'
(ROOT/'design/style-guide/assets/mark.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Inksheaf"><g fill="currentColor">'+mark+'</g></svg>')
(ROOT/'design/style-guide/assets/favicon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="2" fill="#181a19"/><g fill="#fafaf7">'+mark+'</g></svg>')
print('Built outlined wordmarks and favicon.')
