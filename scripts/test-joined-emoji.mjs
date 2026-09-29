import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {emitTypst} from './lib/typst-emit.mjs';

const dir=mkdtempSync(join(tmpdir(),'joined-emoji-'));
try{
 const article=(title,body)=>`<section class="article"><header class="arthead"><h2 class="arttitle">${title}</h2></header><div class="artbody">${body}</div></section>`;
 const examples=['🤷‍♀️','🤷‍♂️','🤷🏽‍♀️','👩‍🍳','👨‍👩‍👧‍👦'];
 const body=examples.map((emoji,i)=>`<p>Sequence${i} <em>${emoji}</em>(after). <strong>${emoji}</strong>[next].</p>`).join('');
 const html='<html><body>'+article('Joined title 👩‍🍳',body)+article('Ordinary symbols','<p>UnchangedControl: 你好 ♀ ♂ + − ❤️ 1️⃣. Plain letters and punctuation keep their existing font.</p>')+'</body></html>';
 const current=emitTypst(html,{pubName:'Emoji fixture',baseDir:dir});
 const previous=current.replace(/^#show regex\(.*\): set text\(font: "Noto Emoji"\)\n/m,'');
 assert.notEqual(current,previous);
 for(const [name,typ] of [['current',current],['previous',previous]]){
  writeFileSync(join(dir,name+'.typ'),typ);
  execFileSync('typst',['compile','--ignore-system-fonts','--font-path',resolve('fonts'),join(dir,name+'.typ'),join(dir,name+'.pdf')],{stdio:'pipe'});
 }
 execFileSync('python3',['-c',`
import pymupdf as fitz,sys,json
a,b=[fitz.open(p) for p in sys.argv[1:3]]
examples=json.loads(sys.argv[3])
assert len(a)==len(b)
all_spans=lambda d:[s for p in d for b in p.get_text('dict')['blocks'] for l in b.get('lines',[]) for s in l['spans']]
current,previous=all_spans(a),all_spans(b)
assert any('🤷‍♀️' in s['text'] and 'NotoSerifSC' in s['font'] for s in previous), 'Control must reproduce the incomplete fallback'
for emoji in examples:
 found=[s for s in current if emoji in s['text']]
 assert len(found)>=2, (emoji, 'source sequence missing')
 assert all('NotoEmoji' in s['font'] for s in found), (emoji,found)
assert any('👩‍🍳' in s['text'] and s['size']>=18 and 'NotoEmoji' in s['font'] for s in current), 'Title must also shape the complete sequence'
for p in a:
 for span in p.get_texttrace():
  if 'NotoEmoji' in span['font']:
   # MuPDF maps extra codepoints of a shaped ligature to -1 at zero width.
   # That is distinct from glyph 0 (.notdef); require an actual visible glyph.
   assert any(gid>0 for cp,gid,origin,bbox in span['chars'])
   assert all(gid>0 or (gid==-1 and bbox[2]==bbox[0]) for cp,gid,origin,bbox in span['chars']), 'A missing emoji glyph cannot pass as intact'
controls=[i for i,p in enumerate(a) if 'UnchangedControl' in p.get_text()]
assert len(controls)==1
for i in controls:
 assert a[i].get_text()==b[i].get_text()
 assert a[i].get_pixmap(dpi=144).samples==b[i].get_pixmap(dpi=144).samples, 'Standalone symbols or ordinary text changed'
for p in a:
 for block in p.get_text('rawdict')['blocks']:
  for line in block.get('lines',[]):
   for span in line['spans']:
    for c in span['chars']:
     if c['c'].strip():
      x0,y0,x1,y1=c['bbox'];assert x0>=0 and y0>=0 and x1<=p.rect.width and y1<=p.rect.height
`,join(dir,'current.pdf'),join(dir,'previous.pdf'),JSON.stringify(examples)]);
 console.log('PASS joined emoji retain complete source sequences in body and titles; old partial fallback is reproduced; ordinary symbols/CJK/control-page pixels and glyph bounds are preserved');
}finally{rmSync(dir,{recursive:true,force:true});}
