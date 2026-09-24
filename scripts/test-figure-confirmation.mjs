import assert from 'node:assert/strict';
import {adjudicateFigureConfirmation,adjudicateReadingOrderConfirmation,figurePrintEvidence,FigureConfirmation} from './lib/figure-confirmation.mjs';
import {layoutInput,validateLayout,applyLayoutRepairs} from './lib/publisher-layout.mjs';

let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
const figure={id:'wide-screenshot',page:1,source:'/private/bitmap.png',w:326.16,h:208.76,image_width_points:326.16,reading_mode:'column',reading_sizes:[
  {mode:'column',image_width_points:326.16,width_points:326.16,height_points:208.76},
  {mode:'landscape',image_width_points:485.28,width_points:310.61,height_points:485.28},
]};
const answer={confirmed:false,origin:'source_content',note:'The original bitmap is intact.',figure_id:figure.id,defect:'none',reading_detail:'small_text'};
const judge=(overrides={},f=figure)=>adjudicateFigureConfirmation({...answer,...overrides},[f]);
test('faithful small text still requires the largest physical reading size',()=>{
  const result=judge();assert.equal(result.confirmed,true);assert.equal(result.origin,'measured_layout');
  assert.equal(result.defect,'reading_size');assert.equal(result.required_reading_mode,'landscape');
  assert.deepEqual(result.model_confirmation,answer);
});
const landscape={...figure,reading_mode:'landscape',image_width_points:485.28,w:310.61,h:485.28};
test('landscape orientation alone clears but illegible detail at that size holds',()=>{
  assert.equal(judge({confirmed:true,origin:'rendered_layout',defect:'orientation_only'},landscape).confirmed,false);
  assert.equal(judge({confirmed:true,origin:'source_content',defect:'reading_size'},landscape).confirmed,true);
  assert.equal(judge({confirmed:false,origin:'rendered_layout',defect:'none'},landscape).confirmed,false);
});
test('unknown identity, readability, or geometry cannot certify a repair',()=>{
  for(const override of [{figure_id:null},{figure_id:'other'},{reading_detail:'uncertain'},{defect:'uncertain'},{origin:'uncertain'}]){
    assert.equal(judge(override).confirmed,true);assert.equal(judge(override).origin,'uncertain');
  }
  const noSizes={...figure,image_width_points:undefined};
  assert.equal(judge({},noSizes).origin,'uncertain');assert.equal(judge({},noSizes).confirmed,true);
  assert.equal(judge({defect:'reading_size'},noSizes).confirmed,true);
  assert.equal(judge({defect:'reading_size'},noSizes).required_reading_mode,undefined);
  assert.throws(()=>FigureConfirmation.parse({confirmed:false,origin:'source_content',note:'Old untyped response'}));
});
test('pictures and large lettering do not acquire a fine-text enlargement',()=>{
  for(const reading_detail of ['picture','large_labels']){
    const result=judge({reading_detail});assert.equal(result.confirmed,false);assert(!result.required_reading_mode);
  }
});
test('only an actual source crop receives a fidelity exemption',()=>{
  const crop=judge({defect:'crop',reading_detail:'picture'});assert.equal(crop.confirmed,false);assert(crop.source_preserved);
  for(const defect of ['reading_size','caption','missing']){
    const result=judge({defect,reading_detail:'picture'});assert.equal(result.confirmed,true);assert(!result.source_preserved);
  }
});
test('physical evidence includes the reading axis without local source paths',()=>{
  const [e]=figurePrintEvidence([landscape]);assert.equal(e.image_width_points,485.28);assert.equal(e.width_points,310.61);
  assert(!JSON.stringify(e).includes('/private/'));
});
const finding={page:1,check:3,...judge()};
const input=layoutInput({measurement:{pages:[{page:1,blank:.2}],figures:[figure,{...figure,id:'unrelated',page:1}],articles:[]},report:{},fit:{},review:{findings:[finding]}});
const decision={page:1,decision:'repair',candidate_id:'reading:wide-screenshot:landscape',reason:'Enlarge the small text.',space_basis:null};
test('the typed finding offers only the matching image and measured mode',()=>{
  assert.deepEqual(input.candidates.map(c=>c.id),[decision.candidate_id]);
  assert.equal(applyLayoutRepairs({}, {decisions:[decision]},input).readingFigures[figure.id],'landscape');
});
test('layout cannot evade the reading requirement with whitespace or an unrelated repair',()=>{
  assert.throws(()=>validateLayout({decisions:[{...decision,decision:'intentional_space',candidate_id:null,space_basis:'composition'}]},input));
  const another={...input,candidates:[...input.candidates,{id:'another',page:1,operation:'tighten_leading',article:1,leading:.6}]};
  assert.throws(()=>validateLayout({decisions:[{...decision,candidate_id:'another'}]},another),/matching measured enlargement/);
  validateLayout({decisions:[{...decision,decision:'needs_review',candidate_id:null}]},input);
});
test('reading-order screening cannot turn a measured landscape figure into a column-order defect',()=>{
  const typed={...answer,confirmed:true,origin:'rendered_layout',defect:'orientation_only'};
  assert.equal(adjudicateReadingOrderConfirmation(typed,[landscape]).confirmed,false);
  for(const defect of ['paragraph_split','column_order','reading_size'])assert.equal(adjudicateReadingOrderConfirmation({...typed,defect},[landscape]).confirmed,true);
  for(const change of [{figure_id:'missing'},{reading_detail:'uncertain'},{origin:'uncertain'}])assert.equal(adjudicateReadingOrderConfirmation({...typed,...change},[landscape]).origin,'uncertain');
  assert.equal(adjudicateReadingOrderConfirmation(typed,[figure]).required_reading_mode,'landscape');
  assert.equal(adjudicateReadingOrderConfirmation(typed,[{...landscape,reading_mode:'column'}]).confirmed,true);
  assert.throws(()=>adjudicateReadingOrderConfirmation({confirmed:false,note:'Looks fine'},[landscape]));
});
console.log(`${count} figure confirmation checks passed`);
