import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {PDFDocument} from 'pdf-lib';
import {paragraphBoundaryContext,adjudicateBoundaryConfirmation} from './lib/paragraph-boundaries.mjs';
import {pageContext} from './lib/publisher-layout.mjs';
import {reviewPdf} from './lib/page-review.mjs';
const dir=mkdtempSync(join(tmpdir(),'paragraph-boundaries-'));let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
// An independently specified 8+5 paragraph boundary reproduces the annual's
// false flag, using invented text and real PDF extraction rather than private prose.
const pdf=join(dir,'book.pdf'),doc=await PDFDocument.create();
for(let p=1;p<=3;p++){
  const page=doc.addPage([432,648]);
  const lines=p===1?8:p===2?5:2;
  for(let n=0;n<lines;n++)page.drawText(`Paragraph continuation ${p}.${n+1} has several words.`,{x:50,y:648-(p===1?470:65)-n*14,size:10});
}
writeFileSync(pdf,await doc.save());const audit=join(dir,'audit.json');
execFileSync('python3',['scripts/pdf-whitespace-audit.py',pdf,'--out',audit],{stdio:'pipe'});
const measurement={pages:JSON.parse(readFileSync(audit)).pages,paragraphs:[{id:49,start:{page:1,y:460},end:{page:2,y:125}},{id:50,start:{page:3,y:55},end:{page:3,y:90}}]};
try{
await test('actual printed geometry counts eight lines before and five after the page turn',async()=>{
  const b=paragraphBoundaryContext(measurement,1);assert.equal(b.foot.current.line_count,8);assert.equal(b.foot.next.line_count,5);
  assert(b.foot.current.last_line.includes('several words.'));assert.equal(b.verified_no_single_line_fragment,false);
});
await test('a real one-line continuation remains a finding and reaches neighbouring-page confirmation',async()=>{
  const m=structuredClone(measurement);m.paragraphs[0].end.y=68;
  const b=paragraphBoundaryContext(m,2);assert.equal(b.top.current.line_count,1);assert.equal(b.top.status,'single_line_fragment');
  let confirmed=false;
  const r=await reviewPdf(pdf,{outDir:join(dir,'widow'),pageContext:pageContext(m,{}),ask:async({text,images})=>{
    if(text.includes('contact sheet'))return{text:'[{"page":2,"check":2,"confidence":0.9,"note":"A single paragraph line at the top."}]'};
    confirmed=images.length===3&&text.includes('"line_count":1');return{text:'{"confirmed":true,"origin":"rendered_layout","note":"One continuation line.","defect":"single_line_fragment","edge":"top"}'};
  }});
  assert(confirmed);assert.equal(r.findings.length,1);assert.equal(r.errors.length,0);
});
await test('multi-line boundary evidence accompanies confirmation without clearing other checks',async()=>{
  let grounded=false;
  const r=await reviewPdf(pdf,{outDir:join(dir,'multi'),pageContext:pageContext(measurement,{}),ask:async({text})=>{
    if(text.includes('contact sheet'))return{text:'[{"page":1,"check":2,"confidence":0.9,"note":"Last word is alone."},{"page":1,"check":4,"confidence":0.8,"note":"Overflow."}]'};
    if(text.includes('check 2:')){grounded=text.includes('"line_count":8')&&text.includes('"line_count":5')&&text.includes('1.8 has several words.');return{text:'{"confirmed":true,"origin":"rendered_layout","note":"The last word is a widow.","defect":"single_line_fragment","edge":"foot"}'};}
    return{text:'{"confirmed":true,"note":"Overflow still needs inspection."}'};
  }});
  assert(grounded);assert.deepEqual(r.findings.map(f=>f.check),[4]);assert.equal(r.dismissed.length,1);
  assert.equal(r.dismissed[0].origin,'measured_layout');assert.equal(r.dismissed[0].model_confirmation.confirmed,true);
});
await test('an end anchor on the next page is not mistaken for printed continuation',async()=>{
  const m=structuredClone(measurement);m.paragraphs[0].end={page:2,y:55};
  const b=paragraphBoundaryContext(m,1);assert.equal(b.foot.next.line_count,0);assert.equal(b.verified_no_single_line_fragment,false);
});
await test('headings, whole short paragraphs, missing geometry and overlapping anchors remain uncertain',async()=>{
  const heading=structuredClone(measurement);heading.paragraphs=[];assert.equal(paragraphBoundaryContext(heading,1).foot.status,'unknown');
  const missing=structuredClone(measurement);delete missing.pages[0].layout_geometry;assert.equal(paragraphBoundaryContext(missing,1).foot.status,'unknown');
  const overlap=structuredClone(measurement);overlap.paragraphs.push({...overlap.paragraphs[0],id:51});assert.equal(paragraphBoundaryContext(overlap,1).foot.status,'unknown');
  const short=structuredClone(measurement);short.paragraphs[1].end.y=68;assert.equal(paragraphBoundaryContext(short,3).top.status,'complete_single_line_paragraph');
  assert.equal(paragraphBoundaryContext(short,3).verified_no_single_line_fragment,false);
});
await test('two-line headings cannot be cleared as ordinary multi-line paragraphs',async()=>{
  const b=paragraphBoundaryContext(measurement,3);assert.equal(b.top.current.line_count,2);assert.equal(b.verified_no_single_line_fragment,false);
  const heading={confirmed:true,origin:'rendered_layout',note:'A heading needs inspection.',defect:'stranded_heading',edge:'foot'};
  assert.deepEqual(adjudicateBoundaryConfirmation(heading,b),heading);
});
await test('a complete single-line paragraph with an empty next-page end marker is not a split fragment',async()=>{
  const m=structuredClone(measurement),last=m.pages[0].layout_geometry.blocks.filter(b=>b.kind==='text').at(-1);
  m.paragraphs=[{id:1,start:{page:1,y:last.bbox[1]},end:{page:2,y:55}}];
  const b=paragraphBoundaryContext(m,1);assert.equal(b.foot.current.line_count,1);assert.equal(b.foot.next.line_count,0);
  assert.equal(b.foot.printed_complete_on_page,true);assert.equal(b.foot.status,'complete_single_line_paragraph');
  const claim={confirmed:true,origin:'rendered_layout',note:'One-line orphan.',defect:'single_line_fragment',edge:'foot'};
  assert.equal(adjudicateBoundaryConfirmation(claim,b).confirmed,false);
  delete m.pages[1].layout_geometry;
  assert.equal(paragraphBoundaryContext(m,1).foot.status,'unknown');
  assert.equal(adjudicateBoundaryConfirmation(claim,paragraphBoundaryContext(m,1)).confirmed,true);
});
await test('contradictory or untyped verdicts fail validation; unmeasured edges are not waived',async()=>{
  const claim={confirmed:true,origin:'rendered_layout',note:'Single-line defect.',defect:'single_line_fragment',edge:'both'};
  const context=paragraphBoundaryContext(measurement,1);
  assert.equal(adjudicateBoundaryConfirmation(claim,{foot:context.foot}).confirmed,true);
  assert.throws(()=>adjudicateBoundaryConfirmation({...claim,defect:'none'},context),/no defect/);
  assert.throws(()=>adjudicateBoundaryConfirmation({confirmed:false,origin:'uncertain',note:'No result.'},context));
  const uncertain=adjudicateBoundaryConfirmation({...claim,confirmed:false,defect:'uncertain'},context);
  assert.equal(uncertain.confirmed,true);assert.equal(uncertain.origin,'uncertain');
});
console.log(`${passed} paragraph-boundary checks passed`);
}finally{rmSync(dir,{recursive:true,force:true});}
