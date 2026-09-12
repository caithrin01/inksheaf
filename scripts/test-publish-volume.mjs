// Exercise the delivery gate with actual PDF rasterisation and controlled model results.
// The renderer is represented by explicit measured before/after layouts; no paid calls.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {publishVolume} from './lib/publish-volume.mjs';
import {validateLayout} from './lib/publisher-layout.mjs';
import {newRenderBudget,renderUsage,reserveRenderWork} from '../functions/lib/publisher-render-budget.js';
let passed=0;
async function test(name,fn){await fn();console.log('PASS',name);passed++;}
async function scenario({alwaysRepair=false,changeSource=false,visionFails=false,hold=false,leading=.66,interrupted=false,mixedHold=false,persistentHold=false,initialPasses=1,keepSpace=false,imageRole=null}={}){
  const dir=mkdtempSync(join(tmpdir(),'publisher-volume-')),pdf=join(dir,'book.pdf');
  const doc=await PDFDocument.create();doc.addPage([432,648]);doc.addPage([432,648]);if(mixedHold)doc.addPage([432,648]);writeFileSync(pdf,await doc.save());
  let builds=0;const events=[],settings=[],previews=[],visionBuilds=[];
  const source=join(dir,'source.png');if(imageRole)writeFileSync(source,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64'));
  const build=async({initial,passes,beforePass})=>{
    builds++;settings.push({initial,passes});
    for(let pass=1;pass<=(builds===1?initialPasses:1);pass++)await beforePass({pass,initial});
    const repaired=Boolean(initial)&&!alwaysRepair&&(!keepSpace||initial.fitText?.[1]<leading);
    const measurement={pages:[{page:1,blank:.1},{page:2,blank:repaired ? .1 : .7}],articles:[{n:1,start:1,end:2}],fit:[]};
    if(imageRole&&!initial?.pictureFigures?.includes('photo')){measurement.pages=[{page:1,blank:.5,layout_geometry:{trailing_space_points:220}},{page:2,blank:.1}];measurement.figures=[{id:'photo',source,page:2,w:220,h:300,role:'unknown',reading_mode:'column',floating:false}];}
    if(mixedHold)measurement.pages.push({page:3,blank:repaired&&!persistentHold?.1:.7});
    if(interrupted&&!initial?.inFlow?.includes('portrait')){measurement.figures=[{id:'portrait',page:1,y:200,floating:true}];measurement.paragraphs=[{id:1,start:{page:1,y:100},end:{page:2,y:100}}];}
    writeFileSync(pdf.replace('.pdf','.pages.json'),JSON.stringify(measurement));
    return{pdf,report:{included:1,bodyHashes:{source:changeSource&&builds>1?'changed':'original'},postOrder:[{id:1}],publisher:{decisions:[]},fit:{...initial,pass:builds===1?initialPasses:1,fitText:initial?.fitText||{1:leading}}}};
  };
  const state={renderBudget:newRenderBudget()},reserve=(volume,kind)=>reserveRenderWork(state,volume,kind,{id:crypto.randomUUID(),selection_revision:0,run_id:'fixture',started:new Date().toISOString(),settings_hash:'a'.repeat(64)});
  const emit=async e=>events.push(e),publisher={emit,renderUsage:volume=>renderUsage(state,volume),reserveRender:async volume=>reserve(volume,'render'),reserveRepair:async volume=>reserve(volume,'repair'),...(imageRole?{figureRole:async()=>{if(imageRole==='failure')throw Error('Role provider unavailable');return{role:imageRole,reason:'One source image checked.'};}}:{}),vision:async()=>{visionBuilds.push(builds);if(visionFails)throw Error('provider unavailable');return{text:'[]'};},layout:async input=>{
    const result={decisions:input.pages.map(p=>{const held=hold||(mixedHold&&p.page===3);return{page:p.page,decision:held?'needs_review':'repair',candidate_id:held?null:input.candidates.find(c=>c.page===p.page)?.id,reason:held?'A content defect needs investigation.':'Bring the stranded ending back using measured leading.'};})};
    return validateLayout(result,input);
  }};
  const run=()=>publishVolume({build,session:async()=>publisher,emit,volume:'1',reviewDirectory:join(dir,'review'),onRendered:async({book,round,volume})=>previews.push({round,volume,source:book.report.bodyHashes.source})});
  return{run,events,settings,previews,visionBuilds,dir,get builds(){return builds;}};
}
await test('source picture classification shares bounded fitting before the first full-page scan',async()=>{
  const s=await scenario({imageRole:'picture',initialPasses:4}),book=await s.run();
  assert.equal(s.builds,2);assert.equal(s.settings[1].passes,1,'retain one render for later quality repair');
  assert.deepEqual(s.settings[1].initial.pictureFigures,['photo']);assert.equal(s.settings[1].initial.fitFigs.photo,2.05);
  assert(s.visionBuilds.every(n=>n===2),'never pay to scan the known pre-fit photograph gap');
  assert.equal(book.report.layoutAgent.total_render_passes,5);assert.equal(s.previews.length,1);
});
await test('reading, uncertain and failed source-role checks cannot authorize a photo repair',async()=>{
  for(const imageRole of ['reading','uncertain','failure']){
    const s=await scenario({imageRole,hold:true});await assert.rejects(s.run,imageRole==='failure'?/Role provider unavailable/:/closer look/);
    assert.equal(s.builds,1);assert(!s.events.some(e=>e.kind==='review'));
  }
});
await test('a validated repair reaches the builder and the changed PDF is reviewed again',async()=>{
  const s=await scenario(),book=await s.run();
  assert.equal(s.builds,2);assert.equal(s.settings[0].passes,4);assert.equal(s.settings[1].passes,3);
  assert.equal(s.settings[1].initial.fitText[1],.62);assert.equal(book.report.layoutAgent.total_render_passes,2);
  assert.deepEqual(s.previews,[{round:0,volume:'1',source:'original'},{round:1,volume:'1',source:'original'}]);assert.equal(s.events.filter(e=>e.kind==='typesetting').length,2);assert.equal(s.events.at(-1).kind,'review');
});
await test('source mutation during a repair holds the complete edition',async()=>{
  const s=await scenario({changeSource:true});await assert.rejects(s.run,/Source text changed/);assert(!s.events.some(e=>e.kind==='review'));
});
await test('unresolved layout stops without a ready event or extra render',async()=>{
  const s=await scenario({hold:true});await assert.rejects(s.run,/closer look/);assert.equal(s.builds,1);assert(!s.events.some(e=>e.kind==='review'));
  const folder=join(s.dir,'review-0'),names=readdirSync(folder);
  const input=JSON.parse(readFileSync(join(folder,names.find(n=>n.startsWith('layout-input-')))));
  const result=JSON.parse(readFileSync(join(folder,names.find(n=>n.startsWith('layout-result-')))));
  assert.equal(result.status,'completed-review');assert.equal(result.pdf_sha256,input.input.pdf_hash);assert.equal(result.decisions[0].decision,'needs_review');
  assert.deepEqual(input.input.pages[0].visual_context.physical_pages,[1,2]);assert.equal(input.image_hashes.length,1);
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
await test('measured reading-order repair runs before vision and still preserves the final render pass',async()=>{
  const s=await scenario({interrupted:true,initialPasses:4,keepSpace:true}),book=await s.run();
  assert.equal(s.builds,3);assert.equal(s.settings[1].passes,1);assert.equal(s.settings[2].passes,1);
  assert.equal(book.report.layoutAgent.total_render_passes,6);assert(s.settings[2].initial.inFlow.includes('portrait'));
  assert.equal(s.previews.length,2);assert(s.events.some(e=>e.kind==='layout'&&e.message.includes('original paragraphs')));
});
await test('source mutation during deterministic source-position repair is held before preview',async()=>{
  const s=await scenario({interrupted:true,changeSource:true});await assert.rejects(s.run,/Source text changed/);assert.equal(s.previews.length,0);
});
await test('reentering a held volume cannot reset its render or repair allowance',async()=>{
  const exhausted=await scenario({alwaysRepair:true,initialPasses:4});
  await assert.rejects(exhausted.run,/bounded layout repairs/);assert.equal(exhausted.builds,3);
  await assert.rejects(exhausted.run,/bounded layout repairs/);assert.equal(exhausted.builds,3);
  const repairs=await scenario({alwaysRepair:true});
  await assert.rejects(repairs.run,/bounded layout repairs/);assert.equal(repairs.builds,3);
  await assert.rejects(repairs.run,/bounded layout repairs/);assert.equal(repairs.builds,4);
});
console.log(`${passed} complete publisher orchestration checks passed`);
