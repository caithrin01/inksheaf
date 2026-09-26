import assert from 'node:assert/strict';
import {letteringFromGray,letterPoints,legibleReadingSize,MIN_LETTER_POINTS} from './lib/figure-lettering.mjs';
import {adjudicateFigureConfirmation,figurePrintEvidence} from './lib/figure-confirmation.mjs';
import {layoutInput} from './lib/publisher-layout.mjs';

let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
// Synthetic page: rows of letter-like marks at known heights, plus rules and specks.
function page({w=1200,h=800,rows=[],dark=false,rule=true,specks=true}={}){
  const g=new Uint8Array(w*h).fill(dark?0:255),ink=dark?230:20;
  const box=(x0,y0,bw,bh)=>{for(let y=y0;y<y0+bh;y++)for(let x=x0;x<x0+bw;x++)g[y*w+x]=ink;};
  for(const {y,letter,count=12}of rows){
    let x=20;for(let i=0;i<count;i++){const tall=i%4===0?Math.round(letter*1.4):letter;box(x,y+letter-tall,Math.max(2,Math.round(letter*.6)),tall);x+=Math.round(letter*.9);}
  }
  if(rule){box(0,h-40,w,2);box(w-40,0,2,h);}
  if(specks)for(let i=0;i<40;i++)box((i*97)%(w-10),(i*53)%(h-60)+5,2,2);
  return {g,w,h};
}
const measure=p=>letteringFromGray(p.g,p.w,p.h);
const sizes=[{mode:'column',image_width_points:326.16,width_points:326.16,height_points:220},
  {mode:'landscape',image_width_points:483.84,width_points:326.12,height_points:483.84}];

test('the smallest text line governs, ignoring rules and specks',()=>{
  const m=measure(page({rows:[{y:40,letter:30},{y:120,letter:16},{y:200,letter:16},{y:300,letter:30}]}));
  assert.equal(m.min_letter_px,16);assert.equal(m.lines,4);
});
test('light lettering on a dark background is measured',()=>{
  assert.equal(measure(page({dark:true,rows:[{y:60,letter:20},{y:140,letter:20}]})).min_letter_px,20);
});
test('no confident text returns null rather than a size',()=>{
  assert.equal(measure(page({rows:[]})),null);
  assert.equal(measure(page({rows:[{y:60,letter:20}]})),null);
  assert.equal(letteringFromGray(new Uint8Array(10),5,3),null);
});
test('fine text takes the smallest setting that meets the print floor',()=>{
  // 16px of a 1270px source prints at 4.11pt in the column, above 3.6pt.
  const table={min_letter_px:16};
  assert.equal(letterPoints(table,sizes[0],1270),4.11);
  assert.equal(legibleReadingSize(sizes,table,1270).mode,'column');
  // 12px prints at 3.08pt in the column, so the larger setting is required.
  assert.equal(legibleReadingSize(sizes,{min_letter_px:12},1270).mode,'landscape');
  // Too small everywhere, or unmeasured: keep the largest bounded setting.
  assert.equal(legibleReadingSize(sizes,{min_letter_px:4},1270).mode,'landscape');
  assert.equal(legibleReadingSize(sizes,null,1270).mode,'landscape');
  assert.ok(MIN_LETTER_POINTS>=3.5);
});
const column={id:'table',page:1,w:326.16,h:220,image_width_points:326.16,reading_mode:'column',letter_points:4.11,
  reading_sizes:sizes.map(s=>({...s,letter_points:letterPoints({min_letter_px:16},s,1270)}))};
const answer={confirmed:false,origin:'source_content',note:'Faithful table.',figure_id:'table',defect:'none',reading_detail:'small_text'};
test('measured legible lettering does not force the larger setting',()=>{
  const r=adjudicateFigureConfirmation(answer,[column]);
  assert.equal(r.confirmed,false);assert.equal(r.origin,'measured_layout');assert(!r.required_reading_mode);
  assert.match(r.note,/4\.11pt/);
});
test('a reported reading-size defect still requires the larger setting',()=>{
  const r=adjudicateFigureConfirmation({...answer,confirmed:true,defect:'reading_size'},[column]);
  assert.equal(r.required_reading_mode,'landscape');
});
test('below the floor, or unmeasured, fine text still requires the larger setting',()=>{
  const small={...column,letter_points:3.08,reading_sizes:sizes.map(s=>({...s,letter_points:letterPoints({min_letter_px:12},s,1270)}))};
  assert.equal(adjudicateFigureConfirmation(answer,[small]).required_reading_mode,'landscape');
  const {letter_points,...unmeasured}={...column,reading_sizes:sizes};
  assert.equal(adjudicateFigureConfirmation(answer,[unmeasured]).required_reading_mode,'landscape');
});
test('the review packet carries the measured letter size',()=>{
  const [e]=figurePrintEvidence([column]);assert.equal(e.letter_points,4.11);assert.equal(e.reading_sizes[0].letter_points,4.11);
  const {letter_points,...bare}={...column,reading_sizes:sizes};
  assert(!('letter_points' in figurePrintEvidence([bare])[0]));assert(!('letter_points' in figurePrintEvidence([bare])[0].reading_sizes[0]));
});
test('layout review sees the letter size a figure would print at if shrunk into the gap',()=>{
  const plate={id:'timeline',page:2,h:485.28,w:310,floating:false,reading_mode:'landscape',letter_points:4.74,visual_role:{role:'reading'}};
  const measurement={pages:[{page:1,blank:.75,layout_geometry:{trailing_space_points:360}},{page:2,blank:0}],figures:[plate],articles:[{n:1,start:1,end:3}]};
  const input=layoutInput({measurement,report:{},fit:{},review:{findings:[]}});
  const f=input.pages.find(p=>p.page===1).following_source_figure;
  assert.equal(f.printed_letter_points,4.74);assert.equal(f.letter_floor_points,MIN_LETTER_POINTS);
  assert.equal(f.letter_points_if_fitted_to_gap,3.52);assert(f.letter_points_if_fitted_to_gap<f.letter_floor_points);
  const {letter_points,...unmeasured}=plate;
  const g=layoutInput({measurement:{...measurement,figures:[unmeasured]},report:{},fit:{},review:{findings:[]}}).pages.find(p=>p.page===1).following_source_figure;
  assert(!('letter_points_if_fitted_to_gap' in g));
});
console.log(`${count} figure lettering checks passed`);
