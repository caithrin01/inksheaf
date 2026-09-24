// Source quotations can contain several paragraphs belonging to one example.
// Exercise an actual page turn, and an oversized quote that must still paginate.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {emitTypst} from './lib/typst-emit.mjs';
mkdirSync('proofs',{recursive:true});const dir=mkdtempSync(resolve('proofs/source-quotes-'));
const wrap=body=>`<html><body><section class="article"><header class="arthead"><h2 class="arttitle">Quoted examples</h2></header><div class="artbody">${body}</div></section></body></html>`;
const compile=(source,name)=>{
  const typ=join(dir,name+'.typ'),pdf=join(dir,name+'.pdf');writeFileSync(typ,source);
  execFileSync('typst',['compile','--font-path','fonts',typ,pdf],{stdio:'pipe'});
  return {pdf,typ,pages:execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'}).split('\f')};
};
try{
  const short=emitTypst(wrap('<blockquote><p>ExampleFirstMarker is a short quoted example.</p><p>ExplanationLastMarker explains the example with enough detail to occupy more than one printed line in this book.</p></blockquote><p>AfterQuoteMarker returns to ordinary body text.</p>'),{baseDir:dir,publisherWatermarks:false});
  // Leave enough room for the first paragraph, but not its explanation.
  const placed=short.replace('#source-quote[','#pagebreak()\n#v(7.0in)\n#source-quote[');
  const previous=compile(placed.replace('#source-quote[','#quote(block: true)['),'previous');
  const fixed=compile(placed,'kept');
  const on=(book,marker)=>book.pages.findIndex(p=>p.includes(marker));
  assert.notEqual(on(previous,'ExampleFirstMarker'),on(previous,'ExplanationLastMarker'),'The fixture must reproduce the separated example');
  assert.equal(on(fixed,'ExampleFirstMarker'),on(fixed,'ExplanationLastMarker'),'The whole short source quote must share a page');
  for(const marker of ['ExampleFirstMarker','ExplanationLastMarker','AfterQuoteMarker'])assert.equal(fixed.pages.join('').split(marker).length,2);
  const starts=JSON.parse(execFileSync('typst',['query','--font-path','fonts',fixed.typ,'<parstart>','--field','value'],{encoding:'utf8'}));
  assert.equal(starts.filter(p=>p.source_kind==='quote_paragraph').length,2);
  assert(starts.some(p=>p.source_kind==='paragraph'&&p.source_tail.includes('AfterQuoteMarker')),'Quote membership cannot leak into later prose');
  const paragraphs=Array.from({length:60},(_,i)=>`<p>LongQuoteMarker${String(i).padStart(2,'0')} ${'This source paragraph must remain complete and readable. '.repeat(3)}</p>`).join('');
  const long=compile(emitTypst(wrap(`<blockquote>${paragraphs}</blockquote>`),{baseDir:dir,publisherWatermarks:false}),'long');
  assert(long.pages.filter(p=>p.includes('LongQuoteMarker')).length>1,'A long source quotation must still paginate');
  for(let i=0;i<60;i++)assert.equal(long.pages.join('').split(`LongQuoteMarker${String(i).padStart(2,'0')}`).length,2,'Every paragraph prints exactly once');
  const audit=JSON.parse(execFileSync('python3',['-c',`import fitz,json,sys
out=[]
for name in sys.argv[1:]:
 d=fitz.open(name);bad=[];sizes=[]
 for i,p in enumerate(d):
  for b in p.get_text('dict')['blocks']:
   for line in b.get('lines',[]):
    for s in line['spans']:
     if 'Marker' in s['text']: sizes.append(s['size'])
     x0,y0,x1,y1=s['bbox']
     if x0 < -.5 or y0 < -.5 or x1 > p.rect.width+.5 or y1 > p.rect.height+.5: bad.append(i+1)
 out.append({'bad':bad,'sizes':sizes})
print(json.dumps(out))`,fixed.pdf,long.pdf],{encoding:'utf8'}));
  assert(audit.every(a=>a.bad.length===0));assert(audit.every(a=>a.sizes.length&&a.sizes.every(size=>size>=9.79)),'Keeping a quote together cannot shrink type');
  console.log('PASS actual split example kept together; long quote paginates; every source marker and reading size preserved; all text inside physical page bounds');
}finally{if(process.argv.includes('--keep'))console.log(dir);else rmSync(dir,{recursive:true,force:true});}
