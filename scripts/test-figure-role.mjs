import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectFigureRoles} from './lib/figure-role.mjs';
import {layoutInput} from './lib/publisher-layout.mjs';
import {publisherSession} from './lib/publisher-session.mjs';
const dir=mkdtempSync(join(tmpdir(),'figure-role-')),sha=b=>createHash('sha256').update(b).digest('hex');
try{
 execFileSync('python3',['-c',`from PIL import Image
import sys
for name,color in [('a','red'),('b','blue')]:Image.new('RGB',(5000,600),color).save(sys.argv[1]+'/'+name+'.jpg')`,dir]);
 const measurement={pages:[1,2,3,4].map(page=>({page,blank:page%2?.5:0,layout_geometry:{trailing_space_points:210}})),articles:[{n:1,start:1,end:4}],figures:[{id:'photo',source:join(dir,'a.jpg'),page:2,role:'unknown',w:200,h:300},{id:'screen',source:join(dir,'b.jpg'),page:4,role:'unknown',w:200,h:300}]};
 let requests=0;
 const fetchImpl=async(url,options)=>{
  const body=JSON.parse(options.body),content=body.messages[1].content;
  assert.equal(content.length,2,'one source image per role request; no adjacent page ambiguity');
  assert.equal(body.max_tokens,250);assert.equal(body.model,'google/gemini-3.1-flash-lite');
  const data=JSON.parse(content[0].text.split('\n\nSource data:\n')[1]);assert(!content[0].text.includes(dir));
  const bytes=Buffer.from(content[1].image_url.url.split(',')[1],'base64');assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert(bytes.readUInt32BE(16)<=1800);
  const source=measurement.figures.find(f=>f.id===data.figure_id);assert.equal(data.source_sha256,sha(readFileSync(source.source)));
  requests++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({role:data.figure_id==='photo'?'picture':'reading',reason:'Fixture response for this single source image.'})}}],usage:{cost:.001}});
 };
 const session=()=>publisherSession({directory:join(dir,'publisher'),env:{OPENROUTER_API_KEY:'fixture'},fetchImpl});
 const inspect=async()=>inspectFigureRoles({measurement,fit:{},review:{findings:[]},ask:(await session()).figureRole,directory:join(dir,'images')});
 const roles=await inspect();assert.equal(requests,2);assert.equal(roles.photo.role,'picture');assert.equal(roles.screen.role,'reading');
 const packet=layoutInput({measurement,fit:{},report:{},review:{findings:[]},figureRoles:roles});
 assert.deepEqual(packet.candidates.filter(c=>c.requires_picture_confirmation).map(c=>c.figure),['photo']);
 await inspect();assert.equal(requests,2,'replacement worker reuses exact source-image answer');
 writeFileSync(join(dir,'a.jpg'),readFileSync(join(dir,'b.jpg')));await inspect();assert.equal(requests,3,'changed source bytes require a fresh role answer');
 await assert.rejects(inspectFigureRoles({measurement,fit:{},review:{findings:[]},directory:join(dir,'invalid'),ask:async()=>({role:'picture'})}));
 assert.deepEqual(await inspectFigureRoles({measurement,fit:{},review:{findings:[]}}),{});
 console.log('PASS individual source-image identity, bounded PNG conversion, safe candidate filtering, durable byte-bound cache and invalid-role rejection');
}finally{rmSync(dir,{recursive:true,force:true});}
