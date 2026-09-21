import assert from 'node:assert/strict';
import {layoutInput,validateLayout,applyLayoutRepairs,pageContext,layoutBatches,readingOrderFindings,articleEndsHere} from './lib/publisher-layout.mjs';
const input=layoutInput({measurement:{pages:[{page:1,blank:.6,ink_rows:.2},{page:2,blank:.7,ink_rows:.2}],articles:[{n:1,start:1,end:2}],figures:[{id:'figure-1',page:1,role:'picture'}],fit:[{id:'figure-1',page:1,height:2.8}],linkStarts:[{n:1,page:2}]},report:{postOrder:[{id:1}],publisher:{decisions:[{post_id:1,title:'An essay',kind:'essay',reason:'Substantial writing.'}]}},fit:{fitText:{1:.62}},review:{findings:[]},pdfHash:'fixture'});
let n=0;const test=(name,fn)=>{fn();n++;console.log('PASS',name);};
const result={decisions:[{page:1,decision:'repair',candidate_id:'figure:figure-1',reason:'Fit the measured figure.'},{page:2,decision:'repair',candidate_id:'leading:1',reason:'Bring a sparse ending back.'}]};
test('only measured finite figure and leading adjustments are offered',()=>{assert.equal(input.candidates[0].height,2.8);assert.equal(input.candidates[1].leading,.58);});
test('repairs cannot name another page or invent a destructive operation',()=>{for(const candidate_id of ['delete-post:1','leading:1'])assert.throws(()=>validateLayout({decisions:[{...result.decisions[0],candidate_id},result.decisions[1]]},input));});
test('every measured page needs a decision even when the renderer exempted it',()=>{assert.throws(()=>validateLayout({decisions:result.decisions.slice(0,1)},input),/omitted/);});
test('a blank-page justification cannot dismiss an overflow defect',()=>{const altered=structuredClone(input);altered.pages[0].findings=[{check:4}];assert.throws(()=>validateLayout({decisions:[{page:1,decision:'intentional_space',candidate_id:null,reason:'A short poem.'},result.decisions[1]]},altered),/overflow/);});
test('applying a repair changes only bounded typesetter settings',()=>{const before=JSON.stringify(input),initial={fitFigs:{older:3},fitText:{1:.62}};const next=applyLayoutRepairs(initial,result,input);assert.deepEqual(next.fitFigs,{older:3,'figure-1':2.8});assert.equal(next.fitText[1],.58);assert.equal(initial.fitText[1],.62);assert.equal(JSON.stringify(input),before);});
test('a complete short poem may retain intentional space with an explicit reason',()=>{
  const poem=layoutInput({measurement:{pages:[{page:1,blank:.8,ink_rows:.1}],articles:[{n:1,start:1,end:1}]},report:{postOrder:[{id:1}],publisher:{decisions:[{post_id:1,kind:'poem'}]}},fit:{},review:{findings:[]}});
  const verdict={decisions:[{page:1,decision:'intentional_space',candidate_id:null,reason:'A complete short poem occupies its own page.',space_basis:'single_piece'}]};
  assert.equal(validateLayout(verdict,poem).decisions.length,1);
});
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
test('running-head context follows the publication/essay alternation and suppresses openers',()=>{
  const m={engine:'typst',pages:[{page:7},{page:8},{page:9},{page:10}],articles:[{n:1,start:7,end:9}],folios:[{page:7,folio:1},{page:8,folio:2},{page:9,folio:3},{page:10,folio:4}]};
  const p=pageContext(m,{pubName:'The Fox Says',postOrder:[{title:'A real essay'}]});
  assert(p.every(x=>x.running_head_map_available));
  assert.deepEqual(p.map(x=>x.expected_running_head),[null,'The Fox Says','A real essay',null]);
  assert.equal(pageContext({...m,engine:'legacy'},{})[0].running_head_map_available,false);
});
test('large layouts retain exact page coverage in bounded model requests',()=>{
  const pages=Array.from({length:29},(_,i)=>({page:i+1})),b=layoutBatches({pages,candidates:[{id:'last',page:29}],pdf_hash:'same'});
  assert.deepEqual(b.map(x=>x.pages.length),[12,12,5]);assert.deepEqual(b.flatMap(x=>x.pages),pages);assert.equal(b[0].candidates.length,0);assert.equal(b[2].candidates[0].id,'last');assert(b.every(x=>x.pdf_hash==='same'));
});
test('large top and internal gaps cannot disappear behind a small trailing gap',()=>{
  const i=layoutInput({measurement:{pages:[{page:1,blank:.02,ink_top:.8},{page:2,blank:.05,ink_top:0,hole:.5}],articles:[]},report:{},fit:{},review:{findings:[]}});
  assert.equal(i.pages.length,2);assert.equal(i.pages[0].unused_body_fraction_lower_bound,.8200000000000001);assert.equal(i.pages[1].internal_gap_fraction,.5);
});
test('several smaller gaps over 30 percent together require a layout verdict',()=>{
  const i=layoutInput({measurement:{pages:[{page:1,blank:.15,ink_top:.02,hole:.1,unused:.34}],articles:[],whitespace_metric:'Combined measured intervals'},report:{},fit:{},review:{findings:[]}});
  assert.equal(i.pages.length,1);assert.equal(i.pages[0].measured_unused_body_fraction,.34);assert.equal(i.pages[0].whitespace_metric,'Combined measured intervals');
  assert.throws(()=>validateLayout({decisions:[]},i),/omitted/);
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
test('source-position evidence requires actual following text in the same article',()=>{
  const m={paragraphs:[{id:7,start:{page:2,y:100,article:1},end:{page:2,y:140,article:1}}],figures:[{id:'delayed',page:2,y:400,floating:true,article:1,source_next_paragraph:7}],pages:[{page:2,layout_geometry:{blocks:[{kind:'text',text:'The paragraph after the source figure.',bbox:[50,110,300,125]}]}}]};
  assert.equal(readingOrderFindings(m)[0].defect,'delayed_source_figure');
  const missing=structuredClone(m);missing.pages=[];assert.equal(readingOrderFindings(missing).length,0);
  const other=structuredClone(m);other.figures[0].article=2;assert.equal(readingOrderFindings(other).length,0);
  const before=structuredClone(m);before.figures[0].y=70;assert.equal(readingOrderFindings(before).length,0);
});
test('a model cannot excuse a measured sparse prose tail as ordinary article separation',()=>{
  const input={pages:[{page:95,position:'article ending',kind:'essay',ink_rows:.04,figures:[],findings:[{check:1}]}],candidates:[{id:'leading:16',page:95}]};
  const verdict={decisions:[{page:95,decision:'intentional_space',candidate_id:null,reason:'Only the final two lines remain; trailing space is normal article-end separation.',space_basis:'article_end'}]};
  assert.throws(()=>validateLayout(verdict,input),/sparse prose tail/);
  assert.equal(validateLayout({decisions:[{page:95,decision:'repair',candidate_id:'leading:16',reason:'Bring the two stranded lines back.'}]},input).decisions[0].decision,'repair');
  assert.equal(validateLayout({decisions:[{page:95,decision:'needs_review',candidate_id:null,reason:'The sparse tail remains unresolved.'}]},input).decisions[0].decision,'needs_review');
  for(const kind of ['poem','recipe']){const special=structuredClone(input);special.pages[0].kind=kind;assert.equal(validateLayout(verdict,special).decisions.length,1);}
  const complete=structuredClone(input);complete.pages[0].position='complete short piece';assert.equal(validateLayout({decisions:[{...verdict.decisions[0],space_basis:'single_piece'}]},complete).decisions.length,1);
});
test('body gaps cannot use an article-ending basis, even with final prose before an image',()=>{
  const m={pages:[{page:1,blank:.7,ink_rows:.12},{page:2,blank:.15}],articles:[{n:1,start:1,end:2}],figures:[{id:'closing-photo',page:2,h:400,w:280}]};
  const i=layoutInput({measurement:m,report:{},fit:{},review:{findings:[]}}),p=i.pages[0];
  assert.deepEqual(p.compiled_article_span,{start:1,end:2});assert.equal(p.sparse_prose_ending,false);assert(p.allowed_space_bases.includes('figure_sequence'));assert(!p.allowed_space_bases.includes('article_end'));
  const d={page:1,decision:'intentional_space',candidate_id:null,space_basis:'article_end',reason:'This is the final article page.'};
  assert.throws(()=>validateLayout({decisions:[d]},i),/compiled position/);
  assert.equal(validateLayout({decisions:[{...d,space_basis:'figure_sequence',reason:'Closing prose precedes the full-page photograph in the same article.'}]},i).decisions.length,1);
  assert.throws(()=>validateLayout({decisions:[{...d,space_basis:null}]},i),/space_basis/);
});
test('a held body page cannot invent an article ending before its closing image',()=>{
  const page={page:130,position:'body',compiled_article_span:{start:121,end:131},findings:[],following_source_figure:{id:'closing-screenshot',physical_page:131}};
  const input={pages:[page],candidates:[]},decision={page:130,decision:'needs_review',candidate_id:null,space_basis:null,article_ends_here:true,reason:'The final article page leaves a gap.'};
  assert.throws(()=>validateLayout({decisions:[decision]},input),/article_ends_here must be false/);
  const held=validateLayout({decisions:[{...decision,article_ends_here:false,reason:'The composition before the closing screenshot remains unresolved.'}]},input);
  assert.equal(held.decisions[0].decision,'needs_review','Correct boundary evidence does not itself approve composition');
  assert.equal(articleEndsHere({...page,page:131}),true);
  assert.equal(articleEndsHere({page:1,position:'front matter',compiled_article_span:null}),null);
});
test('following-image fit evidence states lower bounds without waiving content defects',()=>{
  const measurement={pages:[{page:130,blank:.5,layout_geometry:{trailing_space_points:266.45}},{page:131,blank:.1}],articles:[{n:1,start:121,end:131}],figures:[{id:'reading-screenshot',page:131,h:485.28,reading_mode:'landscape',floating:false,visual_role:{role:'reading'}}]};
  const make=m=>layoutInput({measurement:m,report:{},fit:{},review:{findings:[{page:130,check:3,note:'Unreadable image detail.'}]}});
  const input=make(measurement),page=input.pages[0],figure=page.following_source_figure;
  assert.equal(page.article_ends_here,false);assert.equal(figure.reading_size_protected,true);assert.equal(figure.image_alone_fits_in_gap,false);
  assert(Math.abs(figure.minimum_height_shortfall_points-218.83)<1e-9);
  assert(Math.abs(figure.minimum_linear_reduction_fraction_to_fit-(1-266.45/485.28))<1e-9);
  const decision={page:130,decision:'intentional_space',article_ends_here:false,candidate_id:null,space_basis:'figure_sequence',reason:'The reading-sized screenshot must follow its source prose.'};
  assert.throws(()=>validateLayout({decisions:[decision]},input),/content or overflow/);
  for(const gap of [undefined,-1,NaN]){const other=structuredClone(measurement);other.pages[0].layout_geometry.trailing_space_points=gap;const f=make(other).pages[0].following_source_figure;assert.equal(f.image_alone_fits_in_gap,null);assert.equal(f.minimum_height_shortfall_points,null);assert.equal(f.minimum_linear_reduction_fraction_to_fit,null);}
  const fits=structuredClone(measurement);fits.pages[0].layout_geometry.trailing_space_points=500;const f=make(fits).pages[0].following_source_figure;assert.equal(f.image_alone_fits_in_gap,true);assert.equal(f.minimum_height_shortfall_points,0);assert.equal(f.minimum_linear_reduction_fraction_to_fit,0);
});
test('a reduced photograph stranded on its closing leaf cannot pass as intentional space',()=>{
  const measurement={pages:[{page:1,blank:.1},{page:2,blank:.3},{page:3,blank:.76,ink_rows:.236,
    layout_geometry:{body_bounds_points:[44,56,387,592],blocks:[{kind:'image',bbox:[90,67,326,197]}]}}],
    articles:[{n:1,start:1,end:3}],figures:[{id:'closing-photo',page:3,role:'picture',h:130,w:236}]};
  const fit={fitFigs:{'closing-photo':1.81}};
  const packet=(m=measurement,f=fit)=>layoutInput({measurement:m,fit:f,report:{},review:{findings:[]}});
  const input=packet(),verdict={decisions:[{page:3,decision:'intentional_space',candidate_id:null,space_basis:'article_end',reason:'A closing photograph at natural size is intentional.'}]};
  assert.equal(input.pages[0].stranded_picture_fit.figure_id,'closing-photo');
  assert.throws(()=>validateLayout(verdict,input),/still stranded/);
  assert.equal(validateLayout({decisions:[{page:3,decision:'repair',candidate_id:'leading:1',reason:'Bring the closing photograph back beside its prose.'}]},input).decisions[0].decision,'repair');
  assert.equal(validateLayout({decisions:[{page:3,decision:'needs_review',candidate_id:null,reason:'The photograph did not move.'}]},input).decisions[0].decision,'needs_review');
  assert.equal(packet(measurement,{}).pages[0].stranded_picture_fit,null,'A never-fitted source illustration is not a failed repair');
  for(const change of [m=>m.figures[0].h=300,m=>m.figures[0].reading_mode='column',m=>m.figures[0].role='reading',
    m=>m.pages[2].layout_geometry.blocks.push({kind:'text',text:'A source paragraph also occupies the page.'}),m=>m.articles[0].start=3]){
    const other=structuredClone(measurement);change(other);assert.equal(packet(other).pages[0].stranded_picture_fit,null);
  }
});

test('source glyph comparisons survive into layout without clearing space or other defects',()=>{
 const source={page:1,check:6,note:'This broken lettering is present in the source screenshot.',origin:'source_content',source_preserved:true,source_comparisons:1};
 const args={measurement:{pages:[{page:1,blank:.8,ink_rows:.1}],articles:[{n:1,start:1,end:2}]},report:{},fit:{},review:{findings:[{page:1,check:4,note:'Clipped prose.'}],dismissed:[source,{...source,page:2},{...source,source_comparisons:0},{...source,check:3}]}};
 const input=layoutInput(args);assert.equal(input.pages[0].source_observations.length,1);assert.equal(input.pages[0].findings[0].check,4);
 assert.throws(()=>validateLayout({decisions:[{page:1,decision:'intentional_space',candidate_id:null,space_basis:'composition',reason:'Source spelling is preserved.'}]},input),/content or overflow/);
 assert.throws(()=>validateLayout({decisions:[]},input),/omitted/);
});

test('multiple leading repairs for one article keep the tightest bounded setting',()=>{
 const input={pages:[{page:2,findings:[]},{page:4,findings:[]}],candidates:[{id:'before-image',page:2,operation:'tighten_leading',article:1,leading:.54},{id:'ending',page:4,operation:'tighten_leading',article:1,leading:.62}]};
 const result={decisions:input.candidates.map(c=>({page:c.page,decision:'repair',candidate_id:c.id,reason:'Fit the measured prose tail.'}))};
 assert.equal(applyLayoutRepairs({fitText:{1:.66}},result,input).fitText[1],.54);
});
console.log(`${n} bounded publisher layout checks passed`);
