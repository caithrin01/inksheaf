// Magnify actual PDF glyphs; never redraw a character from its Unicode value.
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
export function glyphEvidence(pdf,page,directory){
  mkdirSync(directory,{recursive:true});
  const file=join(directory,'glyphs.png');
  const metadata=JSON.parse(execFileSync('python3',['-c',`
import fitz,json,sys
from PIL import Image,ImageDraw
doc=fitz.open(sys.argv[1]);page=doc[int(sys.argv[2])-1];found=[]
for span in page.get_texttrace():
    for cp,gid,origin,bbox in span['chars']:
        if 'emoji' in span['font'].lower() or cp==0xfffd or gid==0:
            found.append(dict(codepoint='U+%04X'%cp,glyph_id=gid,font=span['font'],size_points=span['size'],bbox=list(bbox)))
selected=found[:8]
if selected:
    sheet=Image.new('RGB',(900,len(selected)*180),'white');draw=ImageDraw.Draw(sheet)
    for i,g in enumerate(selected):
        box=fitz.Rect(g['bbox']);box.x0-=12;box.x1+=12;box.y0-=4;box.y1+=4;box=box & page.rect
        if box.is_empty: raise ValueError('Glyph has no visible PDF bounds')
        pix=page.get_pixmap(matrix=fitz.Matrix(6,6),clip=box,alpha=False)
        image=Image.frombytes('RGB',(pix.width,pix.height),pix.samples);image.thumbnail((880,142))
        draw.text((10,i*180+5),'Actual PDF crop %d: %s, %s, %.2f pt'%(i+1,g['codepoint'],g['font'],g['size_points']),fill='black')
        sheet.paste(image,(10,i*180+28))
    sheet.save(sys.argv[3],'PNG')
print(json.dumps(dict(characters=selected,truncated=len(found)>len(selected))))
`,pdf,String(page),file],{encoding:'utf8',maxBuffer:100000}));
  return metadata.characters.length?{file,...metadata}:null;
}
