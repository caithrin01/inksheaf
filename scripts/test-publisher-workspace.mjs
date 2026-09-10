import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {onRequest as edition} from '../functions/api/edition.js';
import {onRequest as event} from '../functions/api/publisher-event.js';
import {onRequest as retryEmail} from '../functions/api/edition-email.js';
import {enqueueEmail} from '../functions/lib/email-outbox.js';
import {onRequest as state} from '../functions/api/publisher-state.js';
import {hmacHex} from '../functions/lib/press-dispatch.js';
const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
db.exec("INSERT INTO signups (id,publication_url,email,raw_json,plan_json) VALUES (1,'https://writer.substack.com','owner@example.com','{}','{}'),(2,'https://other.substack.com','other@example.com','{}','{}')");
const DB = { prepare(sql) {
  const q = db.prepare(sql); let args = [];
  return {
    bind(...v) { args = v; return this; },
    async first() { return q.get(...args) || null; },
    async all() { return { results: q.all(...args) }; },
    async run() { return { meta: { changes: Number(q.run(...args).changes) } }; },
  };
} };
const env={DB,ARCHIVE_RELAY_TOKEN:'fixture'},sig=m=>hmacHex(env.ARCHIVE_RELAY_TOKEN,m);
const req=(path,body)=>new Request('https://inksheaf.com'+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});
let n=0;async function test(name,fn){await fn();n++;console.log('PASS',name);}
const snapshot=async(id=1,signature=null)=>edition({request:req(`/api/edition?id=${id}&sig=${signature??await sig('edition:1')}`),env});
async function append(e,sequence=1,run='fixture.1'){return event({request:req('/api/publisher-event',{signup_id:1,run_id:run,sequence,event:e,sig:await sig(`publisher:1:${run}:${sequence}:${JSON.stringify(e)}`)}),env});}
await test('private workspace requires a capability scoped to that edition',async()=>{assert.equal((await snapshot(2)).status,403);assert.equal((await snapshot(1,'')).status,403);assert.equal((await snapshot()).status,200);});
await test('workspace is read-only and has no public indexing or caching',async()=>{const before=db.prepare('SELECT total_changes() n').get().n;const r=await snapshot();assert.equal(r.headers.get('cache-control'),'no-store');assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.equal(db.prepare('SELECT total_changes() n').get().n,before);});
await test('events bind their entire payload and replay without duplication',async()=>{const e={kind:'reading',decisions:[{title:'Real source'}],read:1,total:1};assert.equal((await append(e)).status,200);assert.equal((await append(e)).status,200);assert.equal((await append({...e,total:9})).status,409);assert.equal(db.prepare('SELECT count(*) n FROM publisher_events').get().n,1);const bad=await event({request:req('/api/publisher-event',{signup_id:1,run_id:'fixture.1',sequence:2,event:e,sig:await sig('publisher:1:fixture.1:2:changed')}),env});assert.equal(bad.status,403);});
await test('new run replaces prior progress rather than mixing editions',async()=>{await append({kind:'identity',publication:'Second run'},1,'fixture.2');const r=await(await snapshot()).json();assert.equal(r.events.length,1);assert.equal(r.events[0].publication,'Second run');assert.equal(r.run_id,'fixture.2');});
async function save(revision,value){return state({request:req('/api/publisher-state',{signup_id:1,revision,state:value,sig:await sig(`publisher-state:1:${revision}:${JSON.stringify(value)}`)}),env});}
await test('inference reservations survive reload and stale writers cannot reset spend',async()=>{const value={journal:{calls:[{id:'1',status:'reserved',reserved:.2}],spent:0},cache:[]};assert.equal((await save(0,value)).status,200);assert.equal((await save(0,value)).status,409);const r=await state({request:req('/api/publisher-state?id=1&sig='+await sig('publisher-state:1')),env});assert.equal((await r.json()).state.journal.calls[0].reserved,.2);assert.equal((await save(1,value)).status,200);});
await test('a creator capability cannot read the private model journal',async()=>{assert.equal((await state({request:req('/api/publisher-state?id=1&sig='+await sig('edition:1')),env})).status,403);const r=await(await snapshot()).json();assert(!('journal' in r));assert(!JSON.stringify(r).includes('reserved'));});
await test('the complete annual-review ledger is durable but excess calls cannot be saved',async()=>{
  const value={journal:{calls:Array.from({length:256},(_,i)=>({id:String(i),cost:.001})),spent:.256},cache:[]};
  assert.equal((await save(2,value)).status,200);
  value.journal.calls.push({id:'overflow',reserved:.1});assert.equal((await save(3,value)).status,400);
  const r=await state({request:req('/api/publisher-state?id=1&sig='+await sig('publisher-state:1')),env});assert.equal((await r.json()).state.journal.calls.length,256);
});
await test('a ready workspace reads actual outbox columns and retries only its saved message',async()=>{
  db.exec("INSERT INTO edition_versions (id,signup_id,plan_json,post_ids,body_hashes,renderer_sha,print_mode,volumes,status) VALUES (1,1,'{}','[]','{}','fixture','bw','[]','proofed')");
  env.INKSHEAF_ENV='production';env.RESEND_API_KEY='fixture';
  await enqueueEmail(env,{operationKey:'proof-ready/1/initial',versionId:1,kind:'proof-ready',recipient:'owner@example.com',message:{subject:'Your PDF',text:'Private fixture PDF'}});
  const data=await(await snapshot()).json();assert.equal(data.ok,true);assert.equal(data.email_status,'queued');assert.match(data.retry_email_sig,/^[a-f0-9]{64}$/);
  const oldFetch=globalThis.fetch;let sends=0;globalThis.fetch=async(_url,options)=>{sends++;assert.deepEqual(JSON.parse(options.body).to,['owner@example.com']);return Response.json({id:'fixture-mail'});};
  try{
    const send=()=>retryEmail({request:req('/api/edition-email',{id:1,sig:data.retry_email_sig,to:'attacker@example.com'}),env});
    await Promise.all([send(),send()]);await send();assert.equal(sends,1);
    assert.equal((await(await snapshot()).json()).email_status,'accepted');assert.equal(db.prepare('SELECT count(*) n FROM edition_versions').get().n,1);
    assert.equal((await retryEmail({request:req('/api/edition-email',{id:1,sig:await sig('edition:1')}),env})).status,403);
    assert.equal((await retryEmail({request:req('/api/edition-email'),env})).status,405);
  }finally{globalThis.fetch=oldFetch;}
});
db.close();console.log(`${n} publisher workspace checks passed`);
