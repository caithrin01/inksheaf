import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {PDFDocument} from 'pdf-lib';
import {publisherSession} from './lib/publisher-session.mjs';
import {publishVolume} from './lib/publish-volume.mjs';
import {onRequest as stateApi} from '../functions/api/publisher-state.js';
import {onRequest as eventApi} from '../functions/api/publisher-event.js';
import {readdirSync} from 'node:fs';

let passed=0;const dirs=[];
const temp=()=>{const p=mkdtempSync(join(tmpdir(),'render-checkpoint-'));dirs.push(p);return p;};
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
const read=dir=>JSON.parse(readFileSync(join(dir,'state.json'),'utf8'));
const local=directory=>publisherSession({directory,env:{},fetchImpl:()=>{throw Error('Unexpected external call');}});
async function fixture(){
  const dir=temp(),pdf=join(dir,'book.pdf'),image=join(dir,'source.png');
  const doc=await PDFDocument.create();doc.addPage([432,648]).drawText('A complete preserved paragraph.',{x:50,y:550,size:10});doc.addPage([432,648]);
  writeFileSync(pdf,await doc.save());writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64'));
  writeFileSync(pdf.replace('.pdf','.pages.json'),JSON.stringify({pages:[{page:1,blank:0},{page:2,blank:0}],figures:[{id:'source',page:1,source:image}],articles:[]}));
  return {dir,pdf,brand:{accent:'#63543a'},report:{included:1,bodyHashes:{one:'original'},publisher:{decisions:[]},fit:{pass:1,fitText:{1:.62},inFlow:['source']}}};
}
try{
await test('a killed worker resumes review at six renders and two repairs without building again',async()=>{
  const book=await fixture(),directory=temp(),s=await local(directory);
  for(let n=0;n<6;n++)await s.reserveRender('1',{pass:n});for(let n=0;n<2;n++)await s.reserveRepair('1',{repair:n});
  const state=read(directory);state.journal={calls:[{id:'retained',cost:.03,reserved:.05}],spent:.03};writeFileSync(join(directory,'state.json'),JSON.stringify(state));
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {publisherSession} from './scripts/lib/publisher-session.mjs';const s=await publisherSession({directory:${JSON.stringify(directory)},env:{}});await s.saveRender('1',${JSON.stringify(book)},'fixture',s.renderScope('1'));process.kill(process.pid,'SIGKILL');`],{encoding:'utf8'});
  assert.equal(child.signal,'SIGKILL',child.stderr);
  const original=readFileSync(book.pdf),journal=read(directory).journal;rmSync(book.dir,{recursive:true});
  let builds=0,scans=0;const events=[];
  const result=await publishVolume({volume:'1',renderIdentity:'fixture',reviewDirectory:join(directory,'review'),emit:async e=>events.push(e),build:async()=>{builds++;throw Error('Must not render');},session:async()=>({...await local(directory),vision:async()=>{scans++;return{text:'[]'};},layout:async()=>({decisions:[]})})});
  assert.equal(builds,0);assert.equal(scans,1);assert(result.recovered);assert.deepEqual(readFileSync(result.pdf),original);
  assert.equal(result.report.layoutAgent.total_render_passes,6);assert.deepEqual(read(directory).journal,journal);
  assert.deepEqual((await local(directory)).renderUsage('1'),{passes:6,repairs:2});assert.equal(events.at(-1).kind,'review');
});
await test('changed request, corrupted bundle and a later interrupted render hold without fallback',async()=>{
  for(const mode of ['request','bytes','pending']){
    const book=await fixture(),directory=temp(),s=await local(directory);await s.reserveRender('1',{});await s.saveRender('1',book,'original',s.renderScope('1'));
    if(mode==='bytes')writeFileSync(join(directory,'renders',read(directory).completedRenders['1'].sha256+'.json.gz'),'corrupt');
    if(mode==='pending')await s.reserveRender('1',{});
    let builds=0;
    await assert.rejects(publishVolume({volume:'1',renderIdentity:mode==='request'?'changed':'original',reviewDirectory:join(directory,'review'),emit:async()=>{},build:async()=>{builds++;},session:()=>local(directory)}),/saved render cannot be verified/);
    assert.equal(builds,0);
  }
});
const db=new DatabaseSync(':memory:');
for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+file,'utf8'));
const DB={prepare(sql){const q=db.prepare(sql);let args=[];return{bind(...v){args=v;return this;},async first(){return q.get(...args)||null;},async run(){return{meta:{changes:Number(q.run(...args).changes)}};}};}};
const remoteEnv={SIGNUP_ID:'1',SITE_BASE:'https://isolated.invalid',ARCHIVE_RELAY_TOKEN:'fixture',GITHUB_RUN_ID:'fixture'};
db.prepare("INSERT INTO signups (id,publication_url,email,raw_json) VALUES (1,'https://writer.substack.com','owner@example.com','{}')").run();
const transport=(url,options)=>{const request=new Request(url,options),env={DB,ARCHIVE_RELAY_TOKEN:'fixture'};return new URL(url).pathname==='/api/publisher-event'?eventApi({request,env}):stateApi({request,env});};
const blobs=new Map(),store={put:async(sha,b)=>blobs.set(sha,Buffer.from(b)),get:async sha=>blobs.get(sha)};
const remote=(directory=temp(),fetchImpl=transport,checkpointStore=store)=>publisherSession({directory,env:remoteEnv,fetchImpl,checkpointStore});
await test('replacement worker restores PDF and original source images through the durable API reference',async()=>{
  const book=await fixture(),workerDir=temp(),s=await remote(workerDir);await s.reserveRender('1',{});
  const original=readFileSync(book.pdf),source=readFileSync(join(book.dir,'source.png'));
  await s.saveRender('1',book,'remote',s.renderScope('1'));rmSync(workerDir,{recursive:true});rmSync(book.dir,{recursive:true});
  const restored=await(await remote()).loadRender('1','remote');assert.deepEqual(readFileSync(restored.pdf),original);
  const m=JSON.parse(readFileSync(restored.pdf.replace('.pdf','.pages.json')));assert.deepEqual(readFileSync(m.figures[0].source),source);
  assert.deepEqual(restored.report.fit.inFlow,['source']);
  assert.deepEqual(restored.brand,{accent:'#63543a'});
});
await test('lost checkpoint acknowledgement recovers its saved pointer; failed upload cannot publish a pointer',async()=>{
  const book=await fixture();let lost=false;
  const s=await remote(temp(),async(url,options)=>{const r=await transport(url,options);if(options?.method==='POST'&&!lost){lost=true;throw Error('lost acknowledgement');}return r;});
  await assert.rejects(s.saveRender('1',book,'acknowledged',s.renderScope('1')),/lost acknowledgement/);
  assert((await(await remote()).loadRender('1','acknowledged')).recovered);
  const failed=await remote(temp(),transport,{put:async()=>{throw Error('upload unavailable');}});
  await assert.rejects(failed.saveRender('1',book,'unsaved',failed.renderScope('1')),/upload unavailable/);
  assert((await(await remote()).loadRender('1','acknowledged')).recovered);
});
await test('stale worker checkpoint cannot overwrite a concurrent reservation or changed selection',async()=>{
  const book=await fixture(),stale=await remote(),renderedScope=stale.renderScope('1');await(await remote()).reserveRender('1',{});
  await assert.rejects((await remote()).saveRender('1',book,'stale',renderedScope),/Another render started/);
  await assert.rejects(stale.saveRender('1',book,'stale',stale.renderScope('1')),/could not be saved/);
  await assert.rejects((await remote()).loadRender('1','acknowledged'),/cannot be verified/);
  const before=await remote();db.prepare("INSERT INTO publisher_selections (signup_id,revision,restored_json) VALUES (1,1,'{}')").run();
  await assert.rejects(before.saveRender('1',book,'stale',before.renderScope('1')),{code:'PUBLISHER_SELECTION_CHANGED'});
  const changed=await remote();assert.equal(await changed.loadRender('1','new-selection'),null);assert.equal(changed.renderUsage('1').passes,2);
});
db.close();
console.log(`${passed} saved-render recovery checks passed`);
}finally{for(const dir of dirs)rmSync(dir,{recursive:true,force:true});}
