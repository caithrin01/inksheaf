// Deliberately reordered fake inference; real durable sessions and SQLite API.
// No paid calls or external services.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';
import {openRouterPublisher,PUBLISHER_MODELS} from './lib/publisher-agent.mjs';
import {publisherSession} from './lib/publisher-session.mjs';
import {mapConcurrent,REVIEW_CONCURRENCY} from './lib/async-work.mjs';
import {onRequest as stateApi} from '../functions/api/publisher-state.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const schema=z.object({id:z.number()}),journal=()=>({calls:[],spent:0});
const answer=(data,usage={cost:.001})=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}],usage});
const dirs=[];let passed=0;
const test=async(name,fn)=>{await fn();console.log('PASS',name);passed++;};
try{
await test('separate adapters share a bounded pool, save before inference, and retain out-of-order results',async()=>{
  const ledger=journal();let active=0,peak=0,writes=0,snapshot;
  const persist=async()=>{assert.equal(++writes,1);await pause(2);snapshot=structuredClone(ledger);writes--;};
  const fetchImpl=async(_url,options)=>{
    const id=JSON.parse(JSON.parse(options.body).messages[1].content.split('\n\nSource data:\n')[1]).id;
    assert(snapshot.calls.some(c=>c.status==='reserved'));assert(snapshot.calls.every(c=>ledger.calls.some(x=>x.id===c.id)));
    peak=Math.max(peak,++active);await pause(8+(8-id%8)*4);active--;
    return answer({id},{cost:.00001*(id+1),prompt_tokens:id+1});
  };
  const a=openRouterPublisher({key:'fixture',journal:ledger,persist,fetchImpl});
  const b=openRouterPublisher({key:'fixture',journal:ledger,persist,fetchImpl});
  const results=await Promise.all(Array.from({length:24},(_,id)=>(id%2?a:b).withUsage({role:'reader',task:'Read',data:{id},schema})));
  assert(peak>1);assert(peak<=REVIEW_CONCURRENCY);assert.equal(active,0);
  results.forEach((r,id)=>{assert.equal(r.result.id,id);assert.equal(r.usage.prompt_tokens,id+1);});
  assert.equal(ledger.calls.length,24);assert(ledger.calls.every(c=>c.status==='completed'));
  assert.deepEqual(snapshot,ledger);assert(Math.abs(ledger.spent-.003)<1e-9);
});
await test('concurrent reservations cannot exceed dollars or erase unknown charges',async()=>{
  const ledger=journal(),budget=.03;let calls=0;
  const ask=openRouterPublisher({key:'fixture',journal:ledger,budget,fetchImpl:async()=>{
    calls++;assert(ledger.calls.reduce((s,c)=>s+(c.cost??c.reserved),0)<=budget);await pause(10);return answer({id:1},{});
  }});
  const results=await Promise.allSettled(Array.from({length:20},()=>ask({role:'reader',task:'Read',schema})));
  assert(calls>1&&calls<20);assert(results.some(r=>r.status==='rejected'&&/budget/.test(r.reason.message)));
  assert(ledger.calls.every(c=>c.cost===undefined&&c.reserved>0));
  assert(ledger.calls.reduce((s,c)=>s+c.reserved,0)<=budget);
});
await test('a lost reservation acknowledgement prevents all queued inference',async()=>{
  const ledger=journal();let calls=0;
  const ask=openRouterPublisher({key:'fixture',journal:ledger,persist:async()=>{await pause(2);throw Error('lost acknowledgement');},fetchImpl:async()=>{calls++;return answer({id:1});}});
  const results=await Promise.allSettled(Array.from({length:16},()=>ask({role:'reader',task:'Read',schema})));
  assert(results.every(r=>r.status==='rejected'));assert.equal(calls,0);assert.equal(ledger.calls.length,1);
  assert(ledger.calls[0].reserved>0&&ledger.calls[0].cost===undefined);
});
await test('a failed batch awaits active work and does not start the remaining tasks',async()=>{
  let active=0,started=0;
  await assert.rejects(mapConcurrent(Array.from({length:20},(_,i)=>i),async i=>{
    active++;started++;try{await pause(i===0?1:20);if(i===0)throw Error('failed');}finally{active--;}
  },{concurrency:3}),/failed/);
  assert.equal(started,3);assert.equal(active,0);
});
for(const remote of [false,true])await test(`${remote?'remote CAS':'local file'} retains every concurrent cache entry, verdict and charge across reopening`,async()=>{
  const directory=mkdtempSync(join(tmpdir(),'publisher-concurrent-'));dirs.push(directory);
  const png=join(directory,'image.png');writeFileSync(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64'));
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+file,'utf8'));
  db.exec("INSERT INTO signups (id,publication_url,email,raw_json) VALUES (1,'https://writer.substack.com','owner@example.com','{}')");
  const DB={prepare(sql){const q=db.prepare(sql);let args=[];return{bind(...a){args=a;return this;},async first(){return q.get(...args)||null;},async all(){return{results:q.all(...args)};},async run(){return{meta:{changes:Number(q.run(...args).changes)}};}};}};
  let calls=0,active=0,peak=0;
  const env={OPENROUTER_API_KEY:'fixture',...(remote?{SIGNUP_ID:'1',SITE_BASE:'https://isolated.invalid',ARCHIVE_RELAY_TOKEN:'fixture'}:{})};
  const fetchImpl=async(url,options)=>{
    if(new URL(url).origin==='https://isolated.invalid'){
      await pause(2);const response=await stateApi({request:new Request(url,options),env:{DB,ARCHIVE_RELAY_TOKEN:'fixture'}});assert(response.ok);return response;
    }
    assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');calls++;peak=Math.max(peak,++active);
    const body=JSON.parse(options.body),text=body.messages[1].content[0].text,id=Number(text.match(/case (\d+)/)[1]);
    await pause((8-id%8)*5);active--;
    return answer({findings:[{page:id+1,check:3,confidence:.8,note:'Retain this finding.'}]},{cost:.001,prompt_tokens:id+1});
  };
  const requests=Array.from({length:12},(_,id)=>({model:PUBLISHER_MODELS.reader.id,images:[png],text:`case ${id}`,maxTokens:800}));
  const worker=await publisherSession({directory,env,fetchImpl});
  const results=await mapConcurrent(requests,r=>worker.vision(r));
  results.forEach((r,id)=>{assert.equal(JSON.parse(r.text)[0].page,id+1);assert.equal(r.usage.prompt_tokens,id+1);});
  assert(peak>1&&peak<=REVIEW_CONCURRENCY);assert.equal(calls,12);
  const saved=JSON.parse(readFileSync(join(directory,'state.json'),'utf8'));
  assert.equal(saved.cache.length,12);assert.equal(saved.journal.calls.length,12);assert(saved.journal.calls.every(c=>c.status==='completed'));
  if(remote)assert.deepEqual(JSON.parse(db.prepare('SELECT payload FROM publisher_state WHERE signup_id=1').get().payload),saved);
  const reopened=await publisherSession({directory,env,fetchImpl});
  await mapConcurrent(requests,r=>reopened.vision(r));assert.equal(calls,12);
  db.close();
});
console.log(`${passed} publisher concurrency checks passed`);
}finally{for(const dir of dirs)rmSync(dir,{recursive:true,force:true});}
