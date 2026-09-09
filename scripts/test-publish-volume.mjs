// Exercise the delivery gate with actual PDF rasterisation and controlled model results.
// The renderer is represented by explicit measured before/after layouts; no paid calls.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {publishVolume} from './lib/publish-volume.mjs';
import {validateLayout} from './lib/publisher-layout.mjs';
let passed=0;
async function test(name,fn){await fn();console.log('PASS',name);passed++;}
async function scenario({alwaysRepair=false,changeSource=false,visionFails=false,hold=false,leading=.66,interrupted=false,mixedHold=false,persistentHold=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'publisher-volume-')),pdf=join(dir,'book.pdf');
  const doc=await PDFDocument.create();doc.addPage([432,648]);doc.addPage([432,648]);if(mixedHold)doc.addPage([432,648]);writeFileSync(pdf,await doc.save());
  let builds=0;const events=[],settings=[];
  const build=async({initial,passes})=>{
    builds++;settings.push({initial,passes});
    const repaired=Boolean(initial)&&!alwaysRepair;
    const measurement={pages:[{page:1,blank:.1},{page:2,blank:repaired ? .1 : .7}],articles:[{n:1,start:1,end:2}],fit:[]};
    if(mixedHold)measurement.pages.push({page:3,blank:repaired&&!persistentHold?.1:.7});
    if(interrupted&&!repaired){measurement.figures=[{id:'portrait',page:1,y:200,floating:true}];measurement.paragraphs=[{id:1,start:{page:1,y:100},end:{page:2,y:100}}];}
    writeFileSync(pdf.replace('.pdf','.pages.json'),JSON.stringify(measurement));
    return{pdf,report:{included:1,bodyHashes:{source:changeSource&&builds>1?'changed':'original'},postOrder:[{id:1}],publisher:{decisions:[]},fit:{pass:1,fitText:{1:leading},...initial}}};
  };
  const emit=async e=>events.push(e),publisher={emit,vision:async()=>{if(visionFails)throw Error('provider unavailable');return{text:'[]'};},layout:async input=>{
    const result={decisions:input.pages.map(p=>{const held=hold||(mixedHold&&p.page===3);return{page:p.page,decision:held?'needs_review':'repair',candidate_id:held?null:input.candidates.find(c=>c.page===p.page)?.id,reason:held?'A content defect needs investigation.':'Bring the stranded ending back using measured leading.'};})};
    return validateLayout(result,input);
  }};
  const run=()=>publishVolume({build,session:async()=>publisher,emit,volume:'1',reviewDirectory:join(dir,'review')});
  return{run,events,settings,get builds(){return builds;}};
}
await test('a validated repair reaches the builder and the changed PDF is reviewed again',async()=>{
  const s=await scenario(),book=await s.run();
  assert.equal(s.builds,2);assert.equal(s.settings[0].passes,4);assert.equal(s.settings[1].passes,3);
  assert.equal(s.settings[1].initial.fitText[1],.62);assert.equal(book.report.layoutAgent.total_render_passes,2);
  assert.equal(s.events.filter(e=>e.kind==='typesetting').length,2);assert.equal(s.events.at(-1).kind,'review');
});
await test('source mutation during a repair holds the complete edition',async()=>{
  const s=await scenario({changeSource:true});await assert.rejects(s.run,/Source text changed/);assert(!s.events.some(e=>e.kind==='review'));
});
await test('unresolved layout stops without a ready event or extra render',async()=>{
  const s=await scenario({hold:true});await assert.rejects(s.run,/closer look/);assert.equal(s.builds,1);assert(!s.events.some(e=>e.kind==='review'));
});
await test('two unsuccessful model repair rounds are a finite hold',async()=>{
  const s=await scenario({alwaysRepair:true});await assert.rejects(s.run,/bounded layout repairs/);assert.equal(s.builds,3);
});
await test('available repairs run before a mixed hold and all affected pages are rechecked',async()=>{
  const s=await scenario({mixedHold:true}),book=await s.run();
  assert.equal(s.builds,2);assert.equal(book.review.pages,3);assert.equal(s.events.at(-1).kind,'review');
});
await test('a finding still held after other repairs cannot emit a ready review',async()=>{
  const s=await scenario({mixedHold:true,persistentHold:true});await assert.rejects(s.run,/closer look/);
  assert.equal(s.builds,2);assert(!s.events.some(e=>e.kind==='review'));
});
await test('unavailable visual review cannot release an unreviewed PDF',async()=>{
  const s=await scenario({visionFails:true});await assert.rejects(s.run,/Page review could not finish/);assert.equal(s.builds,1);assert(!s.events.some(e=>e.kind==='layout'));
});
await test('a model scan with no findings cannot clear a measured paragraph interruption',async()=>{
  const s=await scenario({interrupted:true}),book=await s.run();
  assert.equal(s.builds,2);assert.deepEqual(s.settings[1].initial.inFlow,['portrait']);
  assert.deepEqual(book.review.measured_findings,[]);
});
console.log(`${passed} complete publisher orchestration checks passed`);
