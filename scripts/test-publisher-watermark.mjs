// Actual PDF comparison: branding may add vector marks only on the opening and
// closing matter, without altering text, pagination or any body-page pixels.
import assert from 'node:assert/strict';
import {emitTypst} from './lib/typst-emit.mjs';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pageContext} from './lib/publisher-layout.mjs';
const out='output/brand-prominence';mkdirSync(out,{recursive:true});
const paragraph='The table was the first thing we carried into the room. Before the chairs, before the lamp, there was somewhere to put a cup of tea and open a book. On paper a letter asks for a little space. You can leave it open, come back to a paragraph, or hand it to someone sitting across the table.';
const html=`<html><body><section class="titlepage"><div class="t">The things we keep</div><div class="s">A collected edition</div><div class="a">Synthetic design fixture</div></section><section class="about"><h3>A note on this edition</h3><p>This is a local design specimen for the opening and closing pages. The publication title stays prominent. The Inksheaf mark sits quietly behind the closing matter.</p><p>The words in this specimen are synthetic. No author was contacted, no PDF was uploaded, and no print order was placed.</p><p class="colophon">Set in Source Serif 4 · © 2026 Synthetic fixture</p></section><section class="article" id="art-room"><div class="arthead"><div class="artnum">1</div><h2 class="arttitle">A room with a table</h2><div class="artmeta">A synthetic essay</div></div><div class="artbody">${Array.from({length:8},()=>`<p>${paragraph}</p>`).join('')}</div></section></body></html>`;
for(const [name,publisherWatermarks] of [['plain',false],['marked',true]]){
 const file=`${out}/${name}.typ`;writeFileSync(file,emitTypst(html,{baseDir:out,pubName:'The things we keep',host:'fixture.example',publisherWatermarks}));
 execFileSync('typst',['compile','--font-path','fonts','--ignore-system-fonts',file,`${out}/${name}.pdf`]);
}
const comparison=JSON.parse(execFileSync('python3',['-c',`
import pymupdf as fitz
import json
from pathlib import Path
root=Path('${out}');a=fitz.open(root/'plain.pdf');b=fitz.open(root/'marked.pdf');assert len(a)==len(b)
changes=[];text_same=True;collisions=[]
for i,(old,new) in enumerate(zip(a,b)):
 text_same=text_same and old.get_text()==new.get_text()
 if old.get_pixmap().samples!=new.get_pixmap().samples:changes.append(i+1)
 # The pale mark's individual glyph paths must stay inside paper and clear of
 # source text and folios on these real sparse front/closing-matter fixtures.
 paths=[d for d in new.get_drawings() if d.get('fill') and all(abs(x-y)<.002 for x,y in zip(d['fill'],[237/255,238/255,235/255]))]
 for d in paths:
  assert new.rect.contains(d['rect'])
  for block in new.get_text('dict')['blocks']:
   for line in block.get('lines',[]):
    for span in line.get('spans',[]):
     if fitz.Rect(span['bbox']).intersects(d['rect']):collisions.append(i+1)
for i in [0,len(b)-1]:b[i].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(root/f'book-{i+1}.png')
print(json.dumps({'pages':len(b),'changed':changes,'all_text_matches':text_same,'text_collisions':sorted(set(collisions))}))
`],{encoding:'utf8'}));
assert(comparison.all_text_matches);console.log('PASS all original text and page counts are unchanged');
assert.deepEqual(comparison.changed,[1,comparison.pages]);console.log('PASS only opening and closing matter acquire the vector mark');
assert.deepEqual(comparison.text_collisions,[]);console.log('PASS the mark clears text, folios and trim in the compiled specimen');
const marks=JSON.parse(execFileSync('typst',['query',`${out}/marked.typ`,'<publisher-page>','--field','value','--font-path','fonts'],{encoding:'utf8'}));
assert.deepEqual(marks.map(m=>m.page),comparison.changed);console.log('PASS actual watermark leaves are identified for page review');
const context=pageContext({pages:Array.from({length:comparison.pages},(_,i)=>({page:i+1})),articles:[],publisher_marks:marks},{});
assert(context[0].publisher_mark);assert(context.at(-1).publisher_mark);assert(!context[1].publisher_mark);console.log('PASS the reviewer receives the deliberate watermark context only on marked leaves');
const master=readFileSync('public/brand/wordmark.svg','utf8');assert.equal(readFileSync('public/brand/wordmark-watermark.svg','utf8'),master.replace('fill="currentColor"','fill="#edeeeb"'));console.log('PASS the watermark retains the accepted logo paths exactly');
writeFileSync(`${out}/comparison.json`,JSON.stringify({...comparison,marks,scope:'Synthetic local proof. No upload or order.'},null,2)+'\n');
console.log('6 publisher watermark checks passed');
