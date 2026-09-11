// A bold form/prompt field contains its own value. Treating every field as a
// sticky heading pushes the whole chain away and strands a large blank area.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {emitTypst} from './lib/typst-emit.mjs';
mkdirSync('proofs',{recursive:true});const dir=mkdtempSync(resolve('proofs/field-fixture-'));
try{
  const introduction='IntroMarker: Read the following complete prompt fields.';
  const fields=Array.from({length:9},(_,i)=>`Field${i+1}Marker: {Keep the original writing, preserve every image and explain the useful result for this part of the work}`);
  const prose='The preceding discussion provides useful context for the printed example. '.repeat(19);
  const html=`<html><body><section class="article" id="art-0"><header class="arthead"><h2 class="arttitle">Working with a prompt</h2></header><div class="artbody"><p>${prose}</p><h3>The prompt</h3><blockquote><p><strong>${introduction}</strong></p>${fields.map(t=>`<p><strong>${t}</strong></p>`).join('')}</blockquote><p>ClosingMarker preserves the final source paragraph.</p><p><strong>Ordinary heading</strong></p><p>HeadingBodyMarker stays with its short heading.</p></div></section></body></html>`;
  const typ=join(dir,'fields.typ'),pdf=join(dir,'fields.pdf');
  writeFileSync(typ,emitTypst(html,{baseDir:dir,pubName:'Fixture',host:'example.com'}));
  execFileSync('typst',['compile','--root',process.cwd(),'--font-path','fonts','--ignore-system-fonts',typ,pdf],{stdio:'pipe'});
  const measured=JSON.parse(execFileSync('python3',['-c',`
import json,sys
import pymupdf as fitz
d=fitz.open(sys.argv[1]); markers={}; outside=[]
for n,p in enumerate(d,1):
    for b in p.get_text('dict')['blocks']:
        for line in b.get('lines',[]):
            for s in line['spans']:
                for name in ['IntroMarker','ClosingMarker','HeadingBodyMarker','Ordinary heading']+['Field%dMarker'%i for i in range(1,10)]:
                    if name in s['text']: markers[name]={'page':n,'y':s['bbox'][1]}
    for b in p.get_text('rawdict')['blocks']:
        for line in b.get('lines',[]):
            for s in line['spans']:
                for c in s['chars']:
                    if c['c'].strip() and not p.rect.contains(fitz.Rect(c['bbox'])): outside.append(n)
print(json.dumps({'markers':markers,'outside':outside,'pages':len(d)}))
`,pdf],{encoding:'utf8'}));
  const text=execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'}).replace(/\u00ad/g,'').replace(/-\s*\n\s*(?=[a-z])/g,'').replace(/\s+/g,'');
  for(const field of fields)assert(text.includes(field.replace(/\s+/g,'')),'Every field and value must remain intact');
  assert.equal(measured.markers.Field1Marker.page,measured.markers.IntroMarker.page,'The first field fits below the introduction; it must not be pushed away with the whole bold chain');
  assert.equal(measured.markers['Ordinary heading'].page,measured.markers.HeadingBodyMarker.page);
  assert.equal(measured.outside.length,0);
  console.log('PASS real prompt-field pagination: first field follows the introduction; all nine values, ordinary heading and glyph bounds survive');
}finally{if(process.argv.includes('--keep'))console.log(dir);else rmSync(dir,{recursive:true,force:true});}
