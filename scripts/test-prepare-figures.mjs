import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareSourceFigures,sourceFigureInventory,validateSourceFigureRoles} from './lib/prepare-figures.mjs';
import {publisherSession} from './lib/publisher-session.mjs';
import {emitTypst} from './lib/typst-emit.mjs';
const dir=mkdtempSync(resolve('proofs/early-figures-'));
try{
 execFileSync('python3',['-c',`from PIL import Image,ImageDraw
import sys
for i in range(5):
 im=Image.new('RGB',(2400,1500),('white' if i%2 else 'blue'));ImageDraw.Draw(im).text((10,10),'Source label '+str(i),fill='black');im.save(sys.argv[1]+'/'+str(i)+'.png')`,dir]);
 const html='<html><body><span class="pubsrc">Fixture</span><section class="article"><header class="arthead"><h2 class="arttitle">Figures</h2></header><div class="artbody">'+Array.from({length:5},(_,i)=>`<p>BeforeMarker${i}.</p>${i===1?'<h2>Montage heading</h2>':''}<figure><img src="${i}.png" data-fig="figure-${i}" alt=""></figure><p>AfterMarker${i}.</p>`).join('')+'</div></section></body></html>';
 const inventory=sourceFigureInventory(html,dir);assert.equal(inventory.length,5);
 let requests=0;
 const fetchImpl=async(url,options)=>{
  const body=JSON.parse(options.body),content=body.messages[1].content,data=JSON.parse(content[0].text.split('\n\nSource data:\n')[1]);
  assert.equal(content.length,data.figures.length+1);assert(content.length<=5);
  assert(!content[0].text.includes(dir));requests++;
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({figures:data.figures.map(f=>({figure_id:f.id,role:f.id==='figure-1'?'reading':'picture',reading_detail:f.id==='figure-1'?'small_text':'picture',grid:f.id==='figure-1'?{columns:4,rows:3}:null,reason:'Synthetic role for this independently labelled fixture.'}))})}}],usage:{cost:.001}});
 };
 const session=()=>publisherSession({directory:join(dir,'publisher'),env:{OPENROUTER_API_KEY:'fixture'},fetchImpl});
 const prepare=async()=>prepareSourceFigures({html,baseDir:dir,directory:join(dir,'images'),ask:(await session()).sourceFigures});
 const roles=await prepare();assert.equal(requests,2);assert.equal(Object.keys(roles).length,5);
 assert(Object.entries(roles).filter(([id])=>id!=='figure-1').every(([,r])=>!r.detail_panels),'ordinary images retain their complete originals without detail pages');
 assert.equal(roles['figure-1'].detail_panels.length,6);
 await prepare();assert.equal(requests,2,'same source batches recover without model calls');
 const typ=emitTypst(html,{baseDir:dir,pubName:'Fixture',sourceFigureRoles:roles});
 const input=join(dir,'book.typ'),pdf=join(dir,'book.pdf');writeFileSync(input,typ);
 execFileSync('typst',['compile','--ignore-system-fonts','--font-path','fonts',input,pdf]);
 const figures=JSON.parse(execFileSync('typst',['query','--ignore-system-fonts','--font-path','fonts',input,'<fig>','--field','value'],{encoding:'utf8'}));
 const photo=figures.find(f=>f.id==='figure-0'),screen=figures.find(f=>f.id==='figure-1');
 assert.equal(photo.role,'picture');assert.equal(photo.reading_mode,null);assert.equal(photo.floating,false);
 assert.equal(figures.filter(f=>!f.parent_id).length,inventory.length,'each original is still printed exactly once');
 const details=figures.filter(f=>f.parent_id==='figure-1');assert.equal(details.length,6);
 for(const [i,detail] of details.entries()){
  assert.equal(detail.page,screen.page+i+1,'each detail occupies its own following leaf in source order');
  assert.equal(detail.reading_mode,'landscape');
  const panel=roles['figure-1'].detail_panels[i];
  const scale=(detail.image_width_points/(panel.source_rect[2]-panel.source_rect[0]))/(screen.image_width_points/panel.source_width);
  assert(Math.abs(scale-2)<.001,'two-column details double the source-pixel print scale');
 }
 const audit=join(dir,'panels.json');writeFileSync(audit,JSON.stringify(roles['figure-1'].detail_panels));
 execFileSync('python3',['-c',`import json,sys
from PIL import Image,ImageChops
source=Image.open(sys.argv[1]).convert('RGB');rebuilt=Image.new('RGB',source.size);pixels=0
for p in json.load(open(sys.argv[2])):
 panel=Image.open(p['source']).convert('RGB');rect=p['source_rect']
 assert not ImageChops.difference(source.crop(rect),panel).getbbox(), 'Detail pixels changed'
 rebuilt.paste(panel,(rect[0],rect[1]));pixels+=panel.width*panel.height
assert pixels==source.width*source.height and not ImageChops.difference(source,rebuilt).getbbox(), 'Incomplete or overlapping source coverage'`,join(dir,'1.png'),audit]);
 assert.equal(screen.reading_mode,'landscape');assert(Math.abs(screen.image_width_points-485.28)<.01);
 assert(figures.every(f=>!f.floating),'prepared source figures remain between original paragraphs');
 const text=execFileSync('pdftotext',[pdf,'-'],{encoding:'utf8'});
 const overviewText=execFileSync('pdftotext',['-f',String(screen.page),'-l',String(screen.page),pdf,'-'],{encoding:'utf8'});
 assert(overviewText.includes('Montage heading'),'source heading stays on the overview page');
 for(let i=0;i<5;i++){assert.equal(text.split('BeforeMarker'+i).length-1,1);assert.equal(text.split('AfterMarker'+i).length-1,1);}
 assert.throws(()=>validateSourceFigureRoles({figures:[{...roles['figure-0'],figure_id:'wrong'}]},inventory),/unknown/);
 assert.throws(()=>validateSourceFigureRoles({figures:[roles['figure-0']]},inventory),/omitted/);
 assert.throws(()=>validateSourceFigureRoles({figures:[{...roles['figure-0'],reading_detail:'small_text'}]},inventory.slice(0,1)),/conflicts/);
 assert.throws(()=>validateSourceFigureRoles({figures:[{...roles['figure-0'],grid:{columns:4,rows:3}}]},inventory.slice(0,1)),/grid conflicts/);
 assert.throws(()=>validateSourceFigureRoles({figures:[{...roles['figure-0'],grid:{columns:7,rows:3}}]},inventory.slice(0,1)));
 const ordinary=await prepareSourceFigures({html:'<img data-fig="plain-chart" src="1.png">',baseDir:dir,directory:join(dir,'ordinary'),ask:async()=>({figures:[{figure_id:'plain-chart',role:'reading',reading_detail:'small_text',grid:null,reason:'An ordinary chart with fine labels.'}]})});
 assert(!ordinary['plain-chart'].detail_panels,'fine text alone never triggers added detail pages');
 const panel=roles['figure-1'].detail_panels[0];writeFileSync(panel.source,Buffer.from('changed'));
 assert.throws(()=>emitTypst(html,{baseDir:dir,sourceFigureRoles:roles}),/detail evidence changed/);

 writeFileSync(join(dir,'0.png'),readFileSync(join(dir,'1.png')));
 assert.throws(()=>emitTypst(html,{baseDir:dir,sourceFigureRoles:roles}),/evidence changed/);
 await prepare();assert.equal(requests,3,'changed bitmap invalidates only its batch');
 console.log('PASS source inventory, bounded batch identity, durable cache, first-render landscape, in-flow pictures, printed source markers and stale-evidence refusal');
}finally{rmSync(dir,{recursive:true,force:true});}
