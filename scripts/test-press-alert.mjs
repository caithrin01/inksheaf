// A held book alerts the operator once per run and tells the creator once, with the reason,
// the run and the edition link; ordinary progress sends nothing. No network.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/press-status.js';
import {hmacHex} from '../functions/lib/press-dispatch.js';
const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
const DB={prepare(sql){const q=db.prepare(sql);let a=[];return{bind(...x){a=x;return this;},async first(){return q.get(...a)||null;},async all(){return{results:q.all(...a)};},async run(){const r=q.run(...a);return{meta:{changes:Number(r.changes)}};}};}};
db.prepare("INSERT INTO signups (id,publication_url,email,raw_json) VALUES (20,'https://chrislakin.substack.com','writer@example.com','{}')").run();
const env={DB,ARCHIVE_RELAY_TOKEN:'t',RESEND_API_KEY:'k',INKSHEAF_ENV:'production',OPERATOR_EMAIL:'operator@example.com'};
const sent=[];globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');sent.push(JSON.parse(init.body));return new Response('{}',{status:200});};
const post=async(status,extra={})=>onRequest({request:new Request('https://inksheaf.com/api/press-status',{method:'POST',body:JSON.stringify({signup_id:20,status,sig:await hmacHex('t',`20:${status}`),...extra})}),env});
let n=0;const test=async(name,fn)=>{await fn();n++;console.log('PASS',name);};
await test('ordinary progress sends nothing',async()=>{assert.equal((await post('building')).status,200);assert.equal(sent.length,0);});
await test('a held book alerts the operator with the reason, run and edition link, and tells the creator once',async()=>{
  await post('failed',{message:'Page review could not finish.',run:'37887966414'});
  const op=sent.find(m=>m.to[0]==='operator@example.com'),writer=sent.find(m=>m.to[0]==='writer@example.com');
  assert(op&&writer);assert.match(op.subject,/Book held: chrislakin\.substack\.com \(#20\)/);
  assert.match(op.text,/Page review could not finish/);assert.match(op.text,/actions\/runs\/37887966414/);assert.match(op.text,/edition\?id=20&sig=/);
  assert.match(writer.subject,/needs a person to finish it/);assert.match(writer.text,/nothing you need to do/);assert.equal(writer.reply_to,'caithrin@caithrin.com');
});
await test('the same failed run reporting again sends nothing more',async()=>{const before=sent.length;await post('failed',{message:'again',run:'37887966414'});assert.equal(sent.length,before);});
await test('a later failed run alerts the operator again, but the creator is never told twice',async()=>{
  const before=sent.length;await post('building');await post('failed',{message:'second run',run:'4'});
  const added=sent.slice(before);assert.equal(added.length,1);assert.equal(added[0].to[0],'operator@example.com');
});
console.log(`${n} press alert checks passed`);
{
  const {stuckBooks,onRequest:watchdog}=await import('../functions/api/watchdog.js');
  db.prepare("UPDATE signups SET dispatch_status='dispatched', created_at=datetime('now','-2 hours') WHERE id=20").run();
  db.prepare("DELETE FROM press").run();
  db.prepare("INSERT INTO signups (id,publication_url,email,raw_json,dispatch_status,created_at,plan_json) VALUES (21,'https://www.transformernews.ai','s@example.com','{}','dispatched',datetime('now','-2 hours'),?)").run(JSON.stringify({volumes:Array.from({length:12},()=>({}))}));
  db.prepare("INSERT INTO signups (id,publication_url,email,raw_json,dispatch_status,created_at) VALUES (22,'https://done.example','d@example.com','{}','dispatched',datetime('now','-2 hours'))").run();
  db.prepare("INSERT INTO press (signup_id,status,updated_at) VALUES (22,'proofed',datetime('now','-1 hours'))").run();
  await test('a dispatched book with no result in its planned time is stuck; long editions and finished books are not',async()=>{
    const stuck=await stuckBooks(DB);assert.deepEqual(stuck.map(s=>s.signup_id),[20]);assert.equal(stuck[0].status,'never started');
  });
  await test('the watchdog is signed, alerts once per stuck book, and reports the list',async()=>{
    const b=Math.floor(Date.now()/300000),call=async sig=>watchdog({request:new Request(`https://inksheaf.com/api/watchdog?b=${b}&sig=${sig}`),env});
    assert.equal((await call('bad')).status,403);
    const before=sent.length,r=await(await call(await hmacHex('t',`watchdog:${b}`))).json();
    assert.deepEqual(r.stuck.map(s=>s.signup_id),[20]);const added=sent.slice(before);
    assert(added.some(m=>m.to[0]==='operator@example.com'&&/may never have started/.test(m.text)),'operator alerted');
    assert(!added.some(m=>m.to[0]==='writer@example.com'),'a writer already told their book is being finished is not told again');
    const after=sent.length;await call(await hmacHex('t',`watchdog:${b}`));assert.equal(sent.length,after,'one alert per stuck book');
  });
  console.log(`${n} press alert and watchdog checks passed`);
}
