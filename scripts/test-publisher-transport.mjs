import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publisherTransport} from './lib/publisher-transport.mjs';
import {publisherSession} from './lib/publisher-session.mjs';
import {PUBLISHER_MODELS} from './lib/publisher-agent.mjs';
import {onRequest as stateApi} from '../functions/api/publisher-state.js';
import {onRequest as eventApi} from '../functions/api/publisher-event.js';
const site='https://publisher.invalid',secret='fixture',sign=m=>createHmac('sha256',secret).update(m).digest('hex');
const readPath='/api/publisher-state?id=1&sig='+sign('publisher-state:1');
const html=()=>new Response('<!DOCTYPE html><title>temporary upstream error</title>',{status:503});
const lost=()=>new TypeError('fetch failed',{cause:Object.assign(Error('socket closed'),{code:'ECONNRESET'})});
let n=0;
const test=async(name,fn)=>{await fn();console.log('PASS',name);n++;};
function database(){
 const db=new DatabaseSync(':memory:');
 for(const name of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+name,'utf8'));
 db.exec("INSERT INTO signups(id,publication_url,email,raw_json) VALUES(1,'https://writer.substack.com','owner@example.com','{}')");
 const DB={prepare(sql){const query=db.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return query.get(...args)||null;},async all(){return {results:query.all(...args)};},async run(){return {meta:{changes:Number(query.run(...args).changes)}};}};}};
 const api=(url,options)=>new URL(url).pathname==='/api/publisher-event'?eventApi({request:new Request(url,options),env:{DB,ARCHIVE_RELAY_TOKEN:secret}}):stateApi({request:new Request(url,options),env:{DB,ARCHIVE_RELAY_TOKEN:secret}});
 return {db,api};
}
const state={journal:{calls:[],spent:0},cache:[],runs:{}};
function writeRequest(value=state,revision=0){const payload=JSON.stringify(value);return [{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({signup_id:1,revision,state:value,sig:sign(`publisher-state:1:${revision}:${payload}`)})},{revision,payload,readPath}];}
await test('an HTML outage is retried without exposing upstream content',async()=>{
 let calls=0;const delays=[];
 const request=publisherTransport({site,wait:async ms=>delays.push(ms),fetchImpl:async()=>++calls===1?html():Response.json({ok:true,selection:{revision:0,restored:[]}})});
 assert.equal((await request(readPath)).selection.revision,0);assert.equal(calls,2);assert.deepEqual(delays,[500]);
});
await test('persistent malformed success responses stop after three attempts',async()=>{
 let calls=0;const request=publisherTransport({site,wait:async()=>{},fetchImpl:async()=>{calls++;return new Response('<!DOCTYPE secret provider content>');}});
 await assert.rejects(request(readPath),e=>e.code==='PUBLISHER_STATE_UNAVAILABLE'&&/HTTP 200, invalid JSON/.test(e.message)&&!e.message.includes('secret'));assert.equal(calls,3);
});
for(const status of [400,401,403,409])await test(`HTTP ${status} holds immediately without retry`,async()=>{
 let calls=0;const request=publisherTransport({site,wait:async()=>{},fetchImpl:async()=>{calls++;return Response.json({ok:false},{status});}});
 await assert.rejects(request(readPath),new RegExp('HTTP '+status));assert.equal(calls,1);
});
for(const committed of [false,true])await test(`lost save ${committed?'after':'before'} commit reconciles one durable revision`,async()=>{
 const {db,api}=database();let writes=0;const bodies=[];
 try{
  const request=publisherTransport({site,wait:async()=>{},fetchImpl:async(url,options)=>{
   if(options.method==='POST'){writes++;bodies.push(options.body);if(writes===1){if(committed)await api(url,options);throw lost();}}
   return api(url,options);
  }});
  const result=await request('/api/publisher-state',...writeRequest());assert.equal(result.revision,1);
  assert.equal(db.prepare('SELECT revision FROM publisher_state').get().revision,1);assert.equal(writes,committed?1:2);assert(bodies.every(b=>b===bodies[0]));
 }finally{db.close();}
});
await test('conflicting saved payload cannot acknowledge an uncertain write',async()=>{
 let writes=0;const request=publisherTransport({site,wait:async()=>{},fetchImpl:async(_url,options)=>{
  if(options.method==='POST'){writes++;throw lost();}
  return Response.json({ok:true,revision:1,state:{...state,cache:[['different','result']]}});
 }});
 await assert.rejects(request('/api/publisher-state',...writeRequest()),/saved revision changed/);assert.equal(writes,1);
});
await test('unavailable reconciliation stops without another state write',async()=>{
 let writes=0,reads=0;const request=publisherTransport({site,wait:async()=>{},fetchImpl:async(_url,options)=>{if(options.method==='POST')writes++;else reads++;return html();}});
 await assert.rejects(request('/api/publisher-state',...writeRequest()),/HTTP 503/);assert.equal(writes,1);assert.equal(reads,3);
});
await test('event retry keeps the same sequence and does not insert a duplicate',async()=>{
 const {db,api}=database();let writes=0;
 try{
  const event={kind:'checking',volume:'1',total:16,selection_revision:0},payload=JSON.stringify(event);
  const request=publisherTransport({site,wait:async()=>{},fetchImpl:async(url,options)=>{const r=await api(url,options);if(++writes===1)throw lost();return r;}});
  await request('/api/publisher-event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({signup_id:1,run_id:'run.1',sequence:1,event,sig:sign(`publisher:1:run.1:1:${payload}`)})});
  assert.equal(writes,2);assert.equal(db.prepare('SELECT count(*) AS n FROM publisher_events').get().n,1);
 }finally{db.close();}
});
await test('unrelated writes and programming errors are never retried',async()=>{
 let calls=0;const request=publisherTransport({site,wait:async()=>{},fetchImpl:async()=>{calls++;return html();}});
 await assert.rejects(request('/api/version',{method:'POST',body:'{}'}));assert.equal(calls,1);
 const broken=publisherTransport({site,wait:async()=>{},fetchImpl:async()=>{calls++;throw Error('programming defect');}});
 await assert.rejects(broken(readPath),/programming defect/);assert.equal(calls,2);
});
await test('a real session reconciles its reservation before exactly one fake model call',async()=>{
 const {db,api}=database(),directory=mkdtempSync(join(tmpdir(),'publisher-transport-'));let dropped=false,calls=0;
 try{
  const fetchImpl=async(url,options)=>{
   if(new URL(url).origin===site){const r=await api(url,options);if(options?.method==='POST'&&!dropped){dropped=true;throw lost();}return r;}
   assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');calls++;
   const saved=JSON.parse(db.prepare('SELECT payload FROM publisher_state').get().payload);assert.equal(saved.journal.calls.length,1);assert.equal(saved.journal.calls[0].status,'reserved');
   return Response.json({choices:[{finish_reason:'stop',message:{content:'{"findings":[]}'}}],usage:{cost:.001}});
  };
  const session=await publisherSession({directory,env:{SIGNUP_ID:'1',SITE_BASE:site,ARCHIVE_RELAY_TOKEN:secret,OPENROUTER_API_KEY:'fixture'},fetchImpl});
  await session.vision({model:PUBLISHER_MODELS.reader.id,images:[],text:'Read the pages',maxTokens:100});
  assert.equal(calls,1);const saved=JSON.parse(db.prepare('SELECT payload FROM publisher_state').get().payload);assert.equal(saved.journal.calls.length,1);assert.equal(saved.journal.calls[0].cost,.001);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
await test('a real session makes no model call when another payload owns the saved revision',async()=>{
 const {db,api}=database(),directory=mkdtempSync(join(tmpdir(),'publisher-conflict-'));let calls=0;
 try{
  const fetchImpl=async(url,options)=>{
   if(new URL(url).origin!==site){calls++;throw Error('Inference must not start');}
   const r=await api(url,options);
   if(options?.method==='POST'){
    const s=JSON.parse(db.prepare('SELECT payload FROM publisher_state').get().payload);s.cache.push(['another-worker','kept']);
    db.prepare('UPDATE publisher_state SET payload=?').run(JSON.stringify(s));throw lost();
   }
   return r;
  };
  const session=await publisherSession({directory,env:{SIGNUP_ID:'1',SITE_BASE:site,ARCHIVE_RELAY_TOKEN:secret,OPENROUTER_API_KEY:'fixture'},fetchImpl});
  await assert.rejects(session.vision({model:PUBLISHER_MODELS.reader.id,images:[],text:'Read the pages',maxTokens:100}),/saved revision changed/);
  assert.equal(calls,0);const saved=JSON.parse(db.prepare('SELECT payload FROM publisher_state').get().payload);
  assert.equal(saved.journal.calls.length,1);assert(saved.journal.calls[0].reserved>0);assert.deepEqual(saved.cache,[['another-worker','kept']]);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
console.log(`${n} publisher transport checks passed; zero paid inference`);
