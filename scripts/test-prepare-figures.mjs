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
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({figures:data.figures.map(f=>({figure_id:f.id,role:f.id==='figure-1'?'reading':'picture',reading_detail:f.id==='figure-1'?'small_text':'picture',reason:'Synthetic role for this independently labelled fixture.'}))})}}],usage:{cost:.001}});
 };
 const session=()=>publisherSession({directory:join(dir,'publisher'),env:{OPENROUTER_API_KEY:'fixture'},fetchImpl});
 const prepare=async()=>prepareSourceFigures({html,baseDir:dir,directory:join(dir,'images'),ask:(await session()).sourceFigures});
 const roles=await prepare();assert.equal(requests,2);assert.equal(Object.keys(roles).length,5);
 assert(Object.values(roles).every(r=>!r.detail_panels),'default preparation preserves complete originals without generating crops');
 await prepare();assert.equal(requests,2,'same source batches recover without model calls');
 const typ=emitTypst(html,{baseDir:dir,pubName:'Fixture',sourceFigureRoles:roles});
 const input=join(dir,'book.typ'),pdf=join(dir,'book.pdf');writeFileSync(input,typ);
 execFileSync('typst',['compile','--ignore-system-fonts','--font-path','fonts',input,pdf]);
 const figures=JSON.parse(execFileSync('typst',['query','--ignore-system-fonts','--font-path','fonts',input,'<fig>','--field','value'],{encoding:'utf8'}));
 const photo=figures.find(f=>f.id==='figure-0'),screen=figures.find(f=>f.id==='figure-1');
 assert.equal(photo.role,'picture');assert.equal(photo.reading_mode,null);assert.equal(photo.floating,false);
 assert.equal(figures.length,inventory.length,'each original is printed once with no synthetic detail pages');
 assert(!figures.some(f=>f.parent_id));
 assert.equal(screen.reading_mode,'landscape');assert(Math.abs(screen.image_width_points-485.28)<.01);
 assert(figures.every(f=>!f.floating),'prepared source figures remain between original paragraphs');
 const text=execFileSync('pdftotext',[pdf,'-'],{encoding:'utf8'});
 const overviewText=execFileSync('pdftotext',['-f',String(screen.page),'-l',String(screen.page),pdf,'-'],{encoding:'utf8'});
 assert(overviewText.includes('Montage heading'),'source heading stays on the overview page');
 for(let i=0;i<5;i++){assert.equal(text.split('BeforeMarker'+i).length-1,1);assert.equal(text.split('AfterMarker'+i).length-1,1);}
 assert.throws(()=>validateSourceFigureRoles({figures:[{...roles['figure-0'],figure_id:'wrong'}]},inventory),/unknown/);
 assert.throws(()=>validateSourceFigureRoles({figures:[roles['figure-0']]},inventory),/omitted/);
 assert.throws(()=>validateSourceFigureRoles({figures:[{...roles['figure-0'],reading_detail:'small_text'}]},inventory.slice(0,1)),/conflicts/);

 writeFileSync(join(dir,'0.png'),readFileSync(join(dir,'1.png')));
 assert.throws(()=>emitTypst(html,{baseDir:dir,sourceFigureRoles:roles}),/evidence changed/);
 await prepare();assert.equal(requests,3,'changed bitmap invalidates only its batch');
 console.log('PASS source inventory, bounded batch identity, durable cache, first-render landscape, in-flow pictures, printed source markers and stale-evidence refusal');
}finally{rmSync(dir,{recursive:true,force:true});}
