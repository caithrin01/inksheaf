// Identical local page evidence may survive a repair elsewhere in the PDF.
// Mocked provider only; this test never reads or alters a real publisher journal.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publisherSession} from './lib/publisher-session.mjs';
const dirs=[],env={OPENROUTER_API_KEY:'fixture'};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64');
let passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'inksheaf-layout-evidence-'));dirs.push(directory);
 const image=join(directory,'neighbours.png');writeFileSync(image,png);const imagesByPage=new Map([[1,image]]);
 const input={pdf_hash:'a'.repeat(64),pages:[{page:1,position:'complete short piece',printed_text:'The entire short poem.',findings:[],unused_body_fraction_lower_bound:.5,visual_context:{physical_pages:[1,2],target_page:1},adjacent_layout:{next_page:{printed_text:'Next page.',last_occupied_y_points:100}},following_source_figure:{image_sha256:'c'.repeat(64),role:'reading'}}],candidates:[]};
 let calls=0;
 const fetchImpl=async(_url,options)=>{
  calls++;const body=JSON.parse(options.body),content=body.messages[1].content;
  const data=JSON.parse((typeof content==='string'?content:content[0].text).split('\n\nSource data:\n')[1]);
  assert.equal(data.pdf_hash,input.pdf_hash,'The full PDF binding still reaches the provider');
  return Response.json({id:'fixture-'+calls,choices:[{finish_reason:'stop',message:{content:JSON.stringify({decisions:data.pages.map(p=>({page:p.page,article_ends_here:true,decision:p.findings.some(f=>f.check!==1)?'needs_review':'intentional_space',candidate_id:null,reason:p.findings.length?'The image needs closer review.':'The complete short poem ends here.',space_basis:p.findings.length?null:'single_piece'}))})}}],usage:{cost:.001}});
 };
 const open=()=>publisherSession({directory,env,fetchImpl});
 const review=async(withImages=true)=>(await open()).layout(input,withImages?{imagesByPage}:{});
 const state=()=>JSON.parse(readFileSync(join(directory,'state.json')));
 return {directory,input,image,imagesByPage,open,review,state,calls:()=>calls};
}
try{
await check('unchanged page facts and rasters reuse a verdict across PDFs with both bindings retained',async()=>{
 const f=await fixture(),first=await f.review(),before=f.state();f.input.pdf_hash='b'.repeat(64);
 const second=await f.review();assert.deepEqual(second,first);assert.equal(f.calls(),1);const after=f.state();assert.deepEqual(after.journal,before.journal);
 const entry=after.cache.map(([,v])=>v).find(v=>v.kind==='layout-page-evidence-v1');assert.deepEqual(entry.bindings.map(b=>b.pdf_sha256),['a'.repeat(64),'b'.repeat(64)]);assert.notEqual(entry.bindings[0].request_sha256,entry.bindings[1].request_sha256);
 await f.review();assert.equal(f.state().cache[0][1].bindings.length,2,'Repeated same-PDF reads do not grow provenance');
});
await check('reuse at the original model/render/repair caps leaves every reservation intact',async()=>{
 const f=await fixture();await f.review();const s=await f.open();for(let n=0;n<6;n++)await s.reserveRender('1',{});for(let n=0;n<2;n++)await s.reserveRepair('1',{});
 const exhausted=f.state();exhausted.journal.calls[0].cost=2;exhausted.journal.spent=2;writeFileSync(join(f.directory,'state.json'),JSON.stringify(exhausted));f.input.pdf_hash='b'.repeat(64);
 await f.review();assert.equal(f.calls(),1);assert.deepEqual(f.state().journal,exhausted.journal);assert.deepEqual(f.state().renderBudget,exhausted.renderBudget);
 f.input.pages[0].printed_text='Changed text.';await assert.rejects(f.review(),/budget reached/);assert.equal(f.calls(),1);
});
for(const [name,mutate] of [
 ['printed text',f=>{f.input.pages[0].printed_text='A different poem.';}],
 ['neighbour geometry',f=>{f.input.pages[0].adjacent_layout.next_page.last_occupied_y_points=101;}],
 ['source image identity',f=>{f.input.pages[0].following_source_figure.image_sha256='d'.repeat(64);}],
 ['source reading role',f=>{f.input.pages[0].following_source_figure.role='picture';}],
 ['repair candidates',f=>{f.input.candidates=[{id:'leading:1',page:1,operation:'tighten_leading',article:1,leading:.6}];}],
 ['neighbour raster bytes',f=>{writeFileSync(f.image,Buffer.concat([png,Buffer.from('different raster encoding')]));}],
 ['physical neighbour mapping',f=>{f.input.pages[0].visual_context.physical_pages=[1,3];}],
 ['new content defect',f=>{f.input.pages[0].findings=[{page:1,check:3,note:'Image is too small.'}];}]
])await check(`changed ${name} requires a fresh decision`,async()=>{
 const f=await fixture();await f.review();f.input.pdf_hash='b'.repeat(64);mutate(f);const result=await f.review();assert.equal(f.calls(),2);assert.equal(f.state().journal.calls.length,2);
 if(name==='new content defect')assert.equal(result.decisions[0].decision,'needs_review');
});
await check('text-only requests retain their full PDF identity',async()=>{
 const f=await fixture();await f.review(false);f.input.pdf_hash='b'.repeat(64);await f.review(false);assert.equal(f.calls(),2);
});
await check('missing required image holds even when the old verdict exists',async()=>{
 const f=await fixture();await f.review();f.imagesByPage.clear();f.input.pdf_hash='b'.repeat(64);await assert.rejects(f.review(),/missing a required page image/);assert.equal(f.calls(),1);
});
await check('a cached verdict is revalidated before any reuse',async()=>{
 const f=await fixture();await f.review();const state=f.state();state.cache[0][1].result.decisions[0].page=99;writeFileSync(join(f.directory,'state.json'),JSON.stringify(state));f.input.pdf_hash='b'.repeat(64);await assert.rejects(f.review(),/unknown|page|Layout/i);assert.equal(f.calls(),1);
});
await check('missing prior PDF provenance holds without silently adopting a verdict',async()=>{
 const f=await fixture();await f.review();const state=f.state();state.cache[0][1].bindings=[];writeFileSync(join(f.directory,'state.json'),JSON.stringify(state));f.input.pdf_hash='b'.repeat(64);await assert.rejects(f.review(),/Saved layout evidence is unavailable/);assert.equal(f.calls(),1);
});
console.log(`${passed} layout evidence reuse checks passed`);
}finally{for(const dir of dirs)rmSync(dir,{recursive:true,force:true});}
