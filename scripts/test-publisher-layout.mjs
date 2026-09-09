import assert from 'node:assert/strict';
import {layoutInput,validateLayout,applyLayoutRepairs,pageContext,layoutBatches,readingOrderFindings} from './lib/publisher-layout.mjs';
const input=layoutInput({measurement:{pages:[{page:1,blank:.6,ink_rows:.2},{page:2,blank:.7,ink_rows:.2}],articles:[{n:1,start:1,end:2}],fit:[{id:'figure-1',page:1,height:2.8}],linkStarts:[{n:1,page:2}]},report:{postOrder:[{id:1}],publisher:{decisions:[{post_id:1,title:'An essay',kind:'essay',reason:'Substantial writing.'}]}},fit:{fitText:{1:.62}},review:{findings:[]},pdfHash:'fixture'});
let n=0;const test=(name,fn)=>{fn();n++;console.log('PASS',name);};
const result={decisions:[{page:1,decision:'repair',candidate_id:'figure:figure-1',reason:'Fit the measured figure.'},{page:2,decision:'repair',candidate_id:'leading:1',reason:'Bring a sparse ending back.'}]};
test('only measured finite figure and leading adjustments are offered',()=>{assert.equal(input.candidates[0].height,2.8);assert.equal(input.candidates[1].leading,.58);});
test('repairs cannot name another page or invent a destructive operation',()=>{for(const candidate_id of ['delete-post:1','leading:1'])assert.throws(()=>validateLayout({decisions:[{...result.decisions[0],candidate_id},result.decisions[1]]},input));});
test('every measured page needs a decision even when the renderer exempted it',()=>{assert.throws(()=>validateLayout({decisions:result.decisions.slice(0,1)},input),/omitted/);});
test('a blank-page justification cannot dismiss an overflow defect',()=>{const altered=structuredClone(input);altered.pages[0].findings=[{check:4}];assert.throws(()=>validateLayout({decisions:[{page:1,decision:'intentional_space',candidate_id:null,reason:'A short poem.'},result.decisions[1]]},altered),/overflow/);});
test('applying a repair changes only bounded typesetter settings',()=>{const before=JSON.stringify(input),initial={fitFigs:{older:3},fitText:{1:.62}};const next=applyLayoutRepairs(initial,result,input);assert.deepEqual(next.fitFigs,{older:3,'figure-1':2.8});assert.equal(next.fitText[1],.58);assert.equal(initial.fitText[1],.62);assert.equal(JSON.stringify(input),before);});
test('a complete short poem may retain intentional space with an explicit reason',()=>{const verdict={decisions:input.pages.map(p=>({page:p.page,decision:'intentional_space',candidate_id:null,reason:'A complete short poem occupies its own page.'}))};assert.equal(validateLayout(verdict,input).decisions.length,2);});
test('front matter never inherits a nonexistent article design purpose',()=>{
  const i=layoutInput({measurement:{pages:[{page:1,blank:.8},{page:2,blank:.6}],articles:[{n:1,start:2,end:2}]},report:{postOrder:[{id:1}],publisher:{decisions:[]}},fit:{},review:{findings:[]},pageText:['CONTENTS','A complete piece.']});
  assert.equal(i.pages[0].position,'front matter');assert.equal(i.pages[0].design_purpose,null);
  assert.equal(i.pages[1].position,'complete short piece');assert.match(i.pages[1].design_purpose,/same page/);
});
test('section dividers have a measured identity without exempting adjacent article tails',()=>{
  const i=layoutInput({measurement:{pages:[{page:1,blank:.8},{page:2,blank:1},{page:3,blank:.8}],parts:[{page:1,title:'The second season'}],articles:[{n:1,start:3,end:3}]},report:{postOrder:[{id:1}],publisher:{decisions:[]}},fit:{},review:{findings:[]}});
  assert.equal(i.pages[0].position,'section divider: The second season');assert.equal(i.pages[1].position,'blank verso after a section divider');assert.equal(i.pages[2].position,'complete short piece');
});
test('the visual review gets front-matter verso and actual printed-folio context',()=>{
  const p=pageContext({pages:[{page:6,blank:1},{page:7,blank:.5}],articles:[{n:1,start:7,end:7}],folios:[{page:7,folio:1}]},{postOrder:[{title:'Opening'}]});
  assert.equal(p[0].position,'blank front-matter verso');assert.equal(p[0].expected_printed_folio,null);assert.equal(p[1].expected_printed_folio,1);assert.equal(p[1].page,7);
});
test('large layouts retain exact page coverage in bounded model requests',()=>{
  const pages=Array.from({length:29},(_,i)=>({page:i+1})),b=layoutBatches({pages,candidates:[{id:'last',page:29}],pdf_hash:'same'});
  assert.deepEqual(b.map(x=>x.pages.length),[12,12,5]);assert.deepEqual(b.flatMap(x=>x.pages),pages);assert.equal(b[0].candidates.length,0);assert.equal(b[2].candidates[0].id,'last');assert(b.every(x=>x.pdf_hash==='same'));
});
test('large top and internal gaps cannot disappear behind a small trailing gap',()=>{
  const i=layoutInput({measurement:{pages:[{page:1,blank:.02,ink_top:.8},{page:2,blank:.05,ink_top:0,hole:.5}],articles:[]},report:{},fit:{},review:{findings:[]}});
  assert.equal(i.pages.length,2);assert.equal(i.pages[0].unused_body_fraction_lower_bound,.8200000000000001);assert.equal(i.pages[1].internal_gap_fraction,.5);
});
test('reading-order repairs only move measured nearby floats back to their source position',()=>{
  const i=layoutInput({measurement:{pages:[{page:1,blank:.1},{page:2,blank:.1},{page:3,blank:.1}],articles:[{n:1,start:1,end:3}],figures:[{id:'near',page:2,floating:true},{id:'far',page:3,floating:true},{id:'fixed',page:1,floating:false}]},report:{},fit:{},review:{findings:[{page:1,check:8}]}});
  assert.deepEqual(i.candidates.map(c=>c.figure),['near']);
  const r={decisions:[{page:1,decision:'repair',candidate_id:i.candidates[0].id,reason:'Keep the portrait between its original paragraphs.'}]};
  assert.deepEqual(applyLayoutRepairs({},r,i).inFlow,['near']);
  assert.equal(layoutInput({measurement:{pages:[{page:1,blank:.1}],figures:[{id:'near',page:1,floating:true}]},report:{},fit:{inFlow:['near']},review:{findings:[{page:1,check:8}]}}).candidates.length,0);
});
test('measured paragraph boundaries catch interruptions that vision misses',()=>{
  const m={paragraphs:[{id:7,start:{page:2,y:450},end:{page:3,y:240}}],figures:[{id:'interrupt',page:3,y:70,floating:true},{id:'before',page:2,y:100,floating:true},{id:'after',page:3,y:300,floating:true},{id:'inflow',page:3,y:70,floating:false}]};
  const findings=readingOrderFindings(m);assert.equal(findings.length,1);assert.equal(findings[0].figure_id,'interrupt');assert.equal(findings[0].check,8);assert.equal(findings[0].paragraph_id,7);
});
console.log(`${n} bounded publisher layout checks passed`);
