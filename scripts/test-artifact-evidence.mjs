import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {artifactEvidence} from './lib/artifact-evidence.mjs';
import {reviewPdf} from './lib/page-review.mjs';
const dir=mkdtempSync(join(tmpdir(),'artifact-evidence-'));
try{
 const source=join(dir,'source.jpg'),changed=join(dir,'other.jpg'),file=join(dir,'book.pdf');
 execFileSync('python3',['-c',`from PIL import Image,ImageDraw
import sys
im=Image.new('RGB',(600,320),'white');ImageDraw.Draw(im).text((20,20),'## Literal **source** markup',fill='black');im.save(sys.argv[1])
Image.new('RGB',(600,320),'gray').save(sys.argv[2])`,source,changed]);
 const doc=await PDFDocument.create(),im=await doc.embedJpg(Uint8Array.from(readFileSync(source))),font=await doc.embedFont(StandardFonts.Courier);
 for(const introduced of [false,true]){
  const p=doc.addPage([432,648]);p.drawImage(im,{x:60,y:300,width:300,height:160});
  if(introduced)p.drawText('<section class="content">',{x:60,y:270,size:9,font});
 }
 doc.addPage([612,792]);writeFileSync(file,await doc.save());
 const sources=[{id:'screenshot',source}];
 const faithful=artifactEvidence(file,1,sources),introduced=artifactEvidence(file,2,sources),unmatched=artifactEvidence(file,1,[{id:'different',source:changed}]);
 assert.equal(faithful.typeset_body_characters,0);assert.equal(faithful.source_bitmaps[0].embedded_bytes_match,true);
 assert.deepEqual(faithful.source_bitmaps[0].printed_boxes_points,[[60,188,360,348]]);
 assert.equal(introduced.typeset_body_text,'<section class="content">');assert(introduced.typeset_body_characters>0);assert.equal(introduced.source_bitmaps[0].embedded_bytes_match,true);
 assert.equal(unmatched.source_bitmaps[0].embedded_bytes_match,false);assert.deepEqual(unmatched.source_bitmaps[0].printed_boxes_points,[]);
 assert.equal(artifactEvidence(file,3,sources).available,false,'Unknown page geometry cannot imply absent body text');
 assert.throws(()=>artifactEvidence(file,0,sources),/Invalid physical PDF page/);
 let confirmations=0;
 const result=await reviewPdf(file,{outDir:join(dir,'review'),sourceFigures:[{page:1,...sources[0]},{page:2,...sources[0]}],ask:async request=>{
  if(request.check!==7)return {text:JSON.stringify([1,2].map(page=>({page,check:7,confidence:1,note:'Inspect printed markup.'})))};
  confirmations++;assert(request.images.length<=4);assert(request.text.includes('Actual PDF evidence:'));
  const held=request.text.includes('"physical_page":2');
  assert(request.text.includes(held?'section class=':'"typeset_body_characters":0'));
  return {text:JSON.stringify({confirmed:held,origin:held?'rendered_layout':'source_content',note:held?'Introduced body markup remains held.':'The source bitmap already contains these symbols.'})};
 }});
 assert.equal(confirmations,2);assert.equal(result.errors.length,0);assert.equal(result.findings.length,1);assert.equal(result.findings[0].page,2);
 assert.equal(result.dismissed[0].artifact_evidence.typeset_body_characters,0);assert(result.findings[0].artifact_evidence.typeset_body_characters>0);
 console.log('PASS actual PDF body text, exact source-image bytes and geometry, unmatched/unknown evidence, bounded confirmation packets and retained introduced-markup hold');
}finally{rmSync(dir,{recursive:true,force:true});}
