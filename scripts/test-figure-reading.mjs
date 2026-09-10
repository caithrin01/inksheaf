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
const html=name=>`<html><body><section class="titlepage"><div class="t">Reading figures</div></section><section class="article"><div class="arthead"><h2 class="arttitle">An illustrated piece</h2></div><div class="artbody"><p>BeforeMarker. The source paragraph stays before the figure.</p><figure><img src="${name}.png" data-fig="example" alt=""/><figcaption>CaptionMarker. These labels belong to this image.</figcaption></figure><p>AfterMarker. The source paragraph stays after the figure.</p></div></section></body></html>`;
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
