import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {figureReadingSizes} from './lib/figure-reading.mjs';
import {emitTypst} from './lib/typst-emit.mjs';
import {layoutInput,applyLayoutRepairs,validateLayout,pageContext} from './lib/publisher-layout.mjs';
const out='proofs/fixtures/figure-reading';mkdirSync(out,{recursive:true});let count=0;
const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
test('available modes fit the text block and preserve the 150ppi floor',()=>{
 for(const [w,h] of [[2000,1200],[760,1059],[600,600],[100,80]])for(const s of figureReadingSizes({w,h})){
  assert(s.width_points<=4.53*72+.01);assert(s.height_points<=6.74*72+.01);assert(w/(s.image_width_points/72)>=150);assert(Math.abs(s.image_width_points/s.image_height_points-w/h)<.00001);
 }
 assert.equal(figureReadingSizes({w:760,h:1059}).length,1);assert.equal(figureReadingSizes({w:2000,h:1200}).length,2);assert.deepEqual(figureReadingSizes({w:0,h:2}),[]);
});
execFileSync('python3',['-c',`from PIL import Image,ImageDraw
for name,w,h in [('chart',2000,1200),('feed',760,1059)]:
 im=Image.new('RGB',(w,h),'white');d=ImageDraw.Draw(im)
 d.rectangle((2,2,w-3,h-3),outline='black',width=3)
 for y in range(50,h-50,55):d.text((30,y),'SOURCE LABEL and values: 1234567890',fill='black')
 im.save('${out}/'+name+'.png')
`]);
const html=(name,alt=name==='feed'?'portrait':'chart')=>`<html><body><section class="titlepage"><div class="t">Reading figures</div></section><section class="article"><div class="arthead"><h2 class="arttitle">An illustrated piece</h2></div><div class="artbody"><p>BeforeMarker. The source paragraph stays before the figure.</p><figure><img src="${name}.png" data-fig="example" alt="${alt}"/><figcaption>CaptionMarker. These labels belong to this image.</figcaption></figure><p>AfterMarker. The source paragraph stays after the figure.</p></div></section></body></html>`;
const compiled={};
for(const [name,mode] of [['feed','normal'],['feed','column'],['chart','normal'],['chart','landscape']]){
 const key=name+'-'+mode,file=out+'/'+key;
 writeFileSync(file+'.typ',emitTypst(html(name),{baseDir:out,readingFigures:mode==='normal'?{}:{example:mode}}));
 execFileSync('typst',['compile','--font-path','fonts','--ignore-system-fonts',file+'.typ',file+'.pdf']);
 const figures=JSON.parse(execFileSync('typst',['query','--font-path','fonts','--ignore-system-fonts',file+'.typ','<fig>','--field','value'],{encoding:'utf8'}));
 compiled[key]={file,figure:figures[0]};
}
test('both reading modes increase actual compiled image scale and keep source position',()=>{
 for(const [name,mode] of [['feed','column'],['chart','landscape']]){
  const a=compiled[name+'-normal'].figure,b=compiled[name+'-'+mode].figure;
  assert(b.image_width_points>a.image_width_points*1.12);assert.equal(b.floating,false);assert.equal(a.source,b.source);assert(b.w<=4.53*72+.1);assert(b.h<=6.74*72+.1);assert.equal(b.reading_mode,mode);
 }
});
test('absent image description preserves the bounded reading scale despite a shrinking fit hint',()=>{
 const file=out+'/unknown-feed';
 writeFileSync(file+'.typ',emitTypst(html('feed',''),{baseDir:out,fitFigs:{example:1.4}}));
 execFileSync('typst',['compile','--font-path','fonts','--ignore-system-fonts',file+'.typ',file+'.pdf']);
 const [figure]=JSON.parse(execFileSync('typst',['query','--font-path','fonts','--ignore-system-fonts',file+'.typ','<fig>','--field','value'],{encoding:'utf8'}));
 assert.equal(figure.role,'unknown');assert.equal(figure.reading_mode,'column');
 assert.equal(figure.image_width_points,compiled['feed-column'].figure.image_width_points);
 assert.equal(figure.source,compiled['feed-column'].figure.source);assert.equal(figure.floating,false);
 for(const role of ['unknown','reading']){
  const packet=layoutInput({measurement:{pages:[{page:1,blank:.7}],figures:[{...figure,role,page:1}],fit:[{id:'example',page:1,height:1.4}]},report:{},fit:{},review:{findings:[]}});
  assert(!packet.candidates.some(c=>c.operation==='fit_figure'));
 }
});
// The role decision itself belongs to visual review. These fixtures prove that
// an unconfirmed fit cannot shrink an unknown image and a confirmed, measured
// operation survives rendering without moving or replacing the source bitmap.
const unknown={measurement:{pages:[{page:1,blank:.5,layout_geometry:{trailing_space_points:210}},{page:2,blank:0}],articles:[{n:1,start:1,end:2}],figures:[{id:'example',role:'unknown',page:2,h:300,w:200,reading_mode:'column'}]},report:{},fit:{},review:{findings:[]}};
const pictureEvidence={example:{role:'picture',reason:'A photograph.',image_sha256:'a'.repeat(64)}};
const pictureInput=layoutInput({...unknown,figureRoles:pictureEvidence}),pictureCandidate=pictureInput.candidates.find(c=>c.requires_picture_confirmation);
const pictureDecision={decisions:[{page:1,decision:'repair',candidate_id:pictureCandidate?.id,reason:'The actual photograph keeps its subject visible at the measured size.'}]};
test('an unknown figure gets a conditional measured repair only with actual page evidence',()=>{
 assert(!layoutInput(unknown).candidates.some(c=>c.requires_picture_confirmation));
 for(const role of ['reading','uncertain'])assert(!layoutInput({...unknown,figureRoles:{example:{...pictureEvidence.example,role}}}).candidates.some(c=>c.requires_picture_confirmation));
 assert(pictureCandidate);assert.equal(pictureCandidate.height,1.91);
 assert.throws(()=>validateLayout(pictureDecision,pictureInput),/actual figure page image/);
 pictureInput.pages[0].visual_context={physical_pages:[1,2],target_page:1};
 validateLayout(pictureDecision,pictureInput);
 const next=applyLayoutRepairs({},pictureDecision,pictureInput);assert.deepEqual(next.pictureFigures,['example']);assert.equal(next.fitFigs.example,1.91);
 const retained=applyLayoutRepairs(next,{decisions:[{page:1,decision:'needs_review',candidate_id:null,reason:'Still held.'}]},pictureInput);
 assert.deepEqual(retained.pictureFigures,['example']);
});
test('picture fitting excludes known reading roles, readability defects, prior reading choices and other articles',()=>{
 const cases=[
  {...unknown,measurement:{...unknown.measurement,figures:[{...unknown.measurement.figures[0],role:'reading'}]}},
  {...unknown,review:{findings:[{page:2,check:3}]}},
  {...unknown,fit:{readingFigures:{example:'column'}}},
  {...unknown,measurement:{...unknown.measurement,articles:[{n:1,start:1,end:1},{n:2,start:2,end:2}]}},
  {...unknown,measurement:{...unknown.measurement,pages:[{page:1,blank:.5,layout_geometry:{trailing_space_points:80}},{page:2,blank:0}]}},
  {...unknown,measurement:{...unknown.measurement,pages:[{page:1,blank:.5},{page:2,blank:0}]}},
 ];
 for(const c of cases)assert(!layoutInput({...c,figureRoles:pictureEvidence}).candidates.some(c=>c.requires_picture_confirmation));
});
test('recorded picture repair preserves source order and pixels; a later reading correction takes precedence',()=>{
 const repaired=applyLayoutRepairs({},pictureDecision,pictureInput);
 for(const reading of [false,true]){
  const file=out+'/confirmed-picture'+(reading?'-reading':'');
  writeFileSync(file+'.typ',emitTypst(html('feed',''),{baseDir:out,...repaired,...(reading?{readingFigures:{example:'column'}}:{})}));
  execFileSync('typst',['compile','--font-path','fonts','--ignore-system-fonts',file+'.typ',file+'.pdf']);
  const [figure]=JSON.parse(execFileSync('typst',['query','--font-path','fonts','--ignore-system-fonts',file+'.typ','<fig>','--field','value'],{encoding:'utf8'}));
  assert.equal(figure.role,'picture');assert.equal(figure.floating,false);
  assert.equal(figure.reading_mode,reading?'column':null);
  assert(Math.abs(figure.h-(reading?compiled['feed-column'].figure.h:1.91*72))<.01);
  execFileSync('python3',['-c',`import pymupdf as fitz,sys
from PIL import Image
doc=fitz.open(sys.argv[1]);source=Image.open(sys.argv[2]).convert('RGB');text=''.join(p.get_text() for p in doc)
assert text.index('BeforeMarker')<text.index('CaptionMarker')<text.index('AfterMarker')
seen=0
for p in doc:
 for item in p.get_images(full=True):
  if item[2:4]!=(source.width,source.height):continue
  assert fitz.Pixmap(doc,item[0]).samples==source.tobytes()
  rect=p.get_image_rects(item[0])[0]
  assert fitz.Rect(44,55,388,593).contains(rect)
  assert p.search_for('CaptionMarker')[0].y0>=rect.y1-.2
  seen+=1
assert seen==1`,file+'.pdf',out+'/feed.png']);
 }
});
const checks=JSON.parse(execFileSync('python3',['-c',`
import pymupdf as fitz,json
from pathlib import Path
from PIL import Image
out=Path('${out}');results=[]
for name,mode in [('feed','column'),('chart','landscape')]:
 doc=fitz.open(out/f'{name}-{mode}.pdf');source=Image.open(out/f'{name}.png').convert('RGB');text=''.join(p.get_text() for p in doc)
 for marker in ['BeforeMarker','CaptionMarker','AfterMarker']:assert text.count(marker)==1,marker
 found=[]
 for page in doc:
  assert page.rect.width==432 and page.rect.height==648
  for item in page.get_images(full=True):
   if item[2:4]!=(source.width,source.height):continue
   pix=fitz.Pixmap(doc,item[0]);assert pix.samples==source.tobytes()
   rect=page.get_image_rects(item[0])[0];assert fitz.Rect(44,55,388,593).contains(rect),rect
   captions=page.search_for('CaptionMarker');assert captions and captions[0].y0>=rect.y1-.2
   page.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(out/f'{name}-{mode}.png')
   found.append(page.number+1)
 assert len(found)==1
 results.append({'source':name,'mode':mode,'page':found[0],'pixels_preserved':True,'caption_adjacent':True})
print(json.dumps(results))
`],{encoding:'utf8'}));
test('rendered PDFs preserve bitmap pixels, source markers, caption adjacency and trim bounds',()=>assert.equal(checks.length,2));
const base={measurement:{pages:[{page:1,blank:.1}],figures:[{...compiled['chart-normal'].figure,id:'example',page:1}],fit:[{id:'example',page:1,height:1.8}]},report:{},fit:{fitFigs:{example:2}},review:{findings:[{page:1,check:3,note:'Labels too small'}]}};
const input=layoutInput(base),candidate=input.candidates.find(c=>c.operation==='set_figure_reading_size'&&c.mode==='landscape');
const decision={decisions:[{page:1,decision:'repair',candidate_id:candidate.id,reason:'Give the wide chart a larger reading size.'}]};
test('publisher selects only measured enlargements and cannot invent an operation',()=>{
 assert(candidate);assert.throws(()=>validateLayout({decisions:[{...decision.decisions[0],candidate_id:'reading:example:arbitrary'}]},input));
 assert(!layoutInput({...base,review:{findings:[]}}).candidates.some(c=>c.operation==='set_figure_reading_size'));
});
test('adopted reading mode survives repairs and cannot be shrunk by the layout fitter',()=>{
 const next=applyLayoutRepairs(base.fit,decision,input);assert.deepEqual(next.readingFigures,{example:'landscape'});assert.equal(next.fitFigs.example,undefined);assert.equal(base.fit.fitFigs.example,2);
 const later=layoutInput({...base,measurement:{...base.measurement,figures:[{...compiled['chart-landscape'].figure,id:'example',page:1}]},fit:next});
 assert(!later.candidates.some(c=>['fit_figure','set_figure_reading_size'].includes(c.operation)));
 const context=pageContext({pages:[{page:1}],figures:[{page:1,reading_mode:'landscape'}]},{});assert.match(context[0].figure_orientation,/intentional landscape/);
});
writeFileSync(out+'/result.json',JSON.stringify({checks:count,compiled,pdf_checks:checks},null,2)+'\n');
console.log(`${count} figure reading checks passed`);
