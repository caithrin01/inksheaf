// Real SQLite constraints and actual publisher orchestration; all network effects are stubbed.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {onRequest as restore} from '../functions/api/edition-restore.js';
import {onRequest as version} from '../functions/api/version.js';
import {onRequest as event} from '../functions/api/publisher-event.js';
import {onRequest as state} from '../functions/api/publisher-state.js';
import {onRequest as edition} from '../functions/api/edition.js';
import {hmacHex} from '../functions/lib/press-dispatch.js';
import {readPublisherSelection} from '../functions/lib/publisher-selection.js';
import {withPublisherSelection} from './lib/publisher-selection.mjs';
import {publisherSession} from './lib/publisher-session.mjs';
import {publishSelection} from './lib/publisher-agent.mjs';
const db=new DatabaseSync(':memory:');
for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
let beforeInsert=null;
const DB={prepare(sql){const q=db.prepare(sql);let args=[];return{bind(...a){args=a;return this;},async first(){return q.get(...args)||null;},async all(){return{results:q.all(...args)};},async run(){if(beforeInsert&&sql.startsWith('INSERT INTO edition_versions')){const hook=beforeInsert;beforeInsert=null;await hook();}const r=q.run(...args);return{meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};}};
const env={DB,ARCHIVE_RELAY_TOKEN:'fixture'},sig=m=>hmacHex('fixture',m);
const req=(path,body)=>new Request('https://inksheaf.com'+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});
const seed=id=>{db.prepare("INSERT INTO signups (id,publication_url,email,raw_json,plan_json) VALUES (?,'https://writer.substack.com','owner@example.com','{}','{}')").run(id);db.prepare("INSERT INTO publisher_events (signup_id,run_id,sequence,kind,payload) VALUES (?,'fixture.1',1,'reading',?)").run(id,JSON.stringify({kind:'reading',decisions:['102','106','108'].map(post_id=>({post_id,decision:'set_aside',title:'Source '+post_id}))}));};
const put=async(id,post,signature)=>restore({request:req('/api/edition-restore',{id,post_id:post,sig:signature??await sig('edition-restore:'+id)}),env});
const record=async(id,revision=0)=>version({request:req('/api/version',{signup_id:id,sig:await sig('version:'+id),selection_revision:revision,plan_json:{publisher:{version:2}},post_ids:[101,102],body_hashes:{101:'source'},renderer_sha:'fixture',print_mode:'bw',volumes:[],proof_key:'private.pdf',proof_sha256:'e'.repeat(64),pages:32}),env});
let n=0;async function test(name,fn){await fn();console.log('PASS',name);n++;}
seed(1);seed(2);seed(3);seed(4);
await test('restoration requires its own edition capability and an actual excluded source',async()=>{
  assert.equal((await put(1,'102',await sig('edition:1'))).status,403);
  assert.equal((await put(2,'102',await sig('edition-restore:1'))).status,403);
  assert.equal((await put(1,'unknown')).status,400);
  assert.equal((await put(1,'102\"')).status,400);
  assert.equal((await restore({request:req('/api/edition-restore'),env})).status,405);
  assert.equal((await readPublisherSelection(DB,1)).revision,0);
});
await test('restores merge atomically, repeated clicks are idempotent, and the journal stays intact',async()=>{
  const ledger={journal:{calls:[{id:'old',reserved:.2,status:'reserved'}],spent:0},cache:[],runs:{}};
  db.prepare('INSERT INTO publisher_state (signup_id,payload) VALUES (1,?)').run(JSON.stringify(ledger));
  const responses=await Promise.all([put(1,'102'),put(1,'102'),put(1,'106')]);assert(responses.every(r=>r.status===200));
  const s=await readPublisherSelection(DB,1);assert.equal(s.revision,2);assert.deepEqual(s.restored.sort(),['102','106']);
  assert.deepEqual(JSON.parse(db.prepare('SELECT payload FROM publisher_state WHERE signup_id=1').get().payload),ledger);
  const data=await(await edition({request:req('/api/edition?id=1&sig='+await sig('edition:1')),env})).json();assert.deepEqual(data.selection,s);assert(data.restore_sig);
});
await test('old-selection progress cannot replace the corrected edition on screen',async()=>{
  const e={kind:'contents',selection_revision:0,sections:[]},payload=JSON.stringify(e);
  const r=await event({request:req('/api/publisher-event',{signup_id:1,run_id:'fixture.1',sequence:2,event:e,sig:await sig('publisher:1:fixture.1:2:'+payload)}),env});
  assert.equal(r.status,409);assert.equal(db.prepare('SELECT count(*) n FROM publisher_events WHERE signup_id=1').get().n,1);
});
await test('a restart identity cannot hide another piece the creator was just inspecting',async()=>{
  db.prepare("INSERT INTO publisher_events (signup_id,run_id,sequence,kind,payload) VALUES (1,'fixture.1.s2',1,'identity','{}')").run();
  assert.equal((await put(1,'108')).status,200);assert.equal((await readPublisherSelection(DB,1)).revision,3);
});
await test('a stale complete PDF cannot create a version or overwrite the saved plan',async()=>{
  const r=await record(1,0);assert.equal(r.status,409);assert.equal((await r.json()).code,'PUBLISHER_SELECTION_CHANGED');
  assert.equal(db.prepare('SELECT count(*) n FROM edition_versions WHERE signup_id=1').get().n,0);
  assert.equal(db.prepare('SELECT plan_json FROM signups WHERE id=1').get().plan_json,'{}');
});
await test('the actual insert constraint catches a correction at the final version boundary',async()=>{
  beforeInsert=()=>put(2,'102');assert.equal((await record(2,0)).status,409);
  assert.equal(db.prepare('SELECT count(*) n FROM edition_versions WHERE signup_id=2').get().n,0);
  assert.equal((await record(2,1)).status,200);
});
await test('when completion wins, a late restore offers the existing adjustment route',async()=>{
  assert.equal((await record(3)).status,200);const r=await put(3,'102');assert.equal(r.status,409);assert.match((await r.json()).change_url,/^\/change\?id=3&sig=/);
  assert.equal((await readPublisherSelection(DB,3)).revision,0);
  assert.equal((await put(2,'102')).status,200); // safe retry of an already saved correction
});
await test('selection changes restart the build and only commit the latest result',async()=>{
  let revision=0,builds=0;const commits=[];
  const result=await withPublisherSelection({load:async()=>({revision,restored:[]}),build:async s=>{builds++;if(builds===1)revision++;return{revision:s.revision};},commit:async b=>{commits.push(b);return b;}});
  assert.equal(builds,2);assert.deepEqual(commits,[{revision:1}]);assert.equal(result.revision,1);
});
await test('a last-moment commit rejection also resumes the current selection',async()=>{
  let revision=0,attempts=0;const result=await withPublisherSelection({load:async()=>({revision,restored:[]}),build:async s=>s,commit:async b=>{if(!attempts++){revision++;throw Error('atomic version boundary rejected');}return b;}});
  assert.equal(result.revision,1);assert.equal(attempts,2);
});
await test('real failures do not loop and repeated changes have a finite recovery bound',async()=>{
  let builds=0;await assert.rejects(withPublisherSelection({load:async()=>({revision:0}),build:async()=>{builds++;throw Error('image unreadable');},commit:async()=>{throw Error('must not commit');}}),/image unreadable/);assert.equal(builds,1);
  let revision=0;await assert.rejects(withPublisherSelection({load:async()=>({revision}),build:async()=>{revision++;},commit:async()=>{throw Error('must not commit');},maxAttempts:2}),/changes are saved/);assert.equal(revision,2);
});
await test('the real session applies saved restores using cached reading and the same budget',async()=>{
  const posts=[{id:101,title:'An essay',slug:'essay',post_date:'2026-01-01',body_html:'<p>A substantial essay about a town library.</p>'},{id:102,title:'A thank you',slug:'thanks',post_date:'2026-01-02',body_html:'<p>Thank you for reading. The newsletter returns next week.</p>'}],cache=new Map();
  await publishSelection({posts,publication:'The Workshop',cache,ask:async({role})=>role==='reader'?{decisions:[{post_id:'101',kind:'essay',decision:'keep',reason:'An essay about the library.',evidence_line:1},{post_id:'102',kind:'housekeeping',decision:'set_aside',reason:'A note to subscribers.',evidence_line:1}]}:{description:'In date order.',sections:[{title:'Collected writing',reason:'Chronological.',post_ids:['101']}]}});
  const ledger={journal:{calls:[{id:'prior',reserved:.2,status:'reserved'}],spent:0},cache:[...cache],runs:{}};
  db.prepare('INSERT INTO publisher_state (signup_id,payload) VALUES (4,?)').run(JSON.stringify(ledger));await put(4,'102');
  const workerEnv={SIGNUP_ID:'4',ARCHIVE_RELAY_TOKEN:'fixture',SITE_BASE:'https://inksheaf.com',OPENROUTER_API_KEY:'test',PUBLISHER_SELECTION_REVISION:'1',GITHUB_RUN_ID:'worker'};
  let calls=0;
  const fetchImpl=async(url,options)=>{
    if(url.startsWith('https://openrouter.ai/')){calls++;const b=JSON.parse(options.body);assert.equal(b.model,'anthropic/claude-sonnet-5');return Response.json({id:'stub',choices:[{finish_reason:'stop',message:{content:JSON.stringify({description:'In date order.',sections:[{title:'Collected writing',reason:'Chronological.',post_ids:['101','102']}]})}}],usage:{cost:.001}});}
    const request=new Request(url,options);return new URL(url).pathname==='/api/publisher-state'?state({request,env}):event({request,env});
  };
  const worker=await publisherSession({directory:mkdtempSync(join(tmpdir(),'publisher-restore-')),env:workerEnv,fetchImpl});
  const result=await worker.read({posts,publication:'The Workshop',volume:'1'});assert.deepEqual(result.included_ids,['101','102']);assert.equal(result.decisions[1].reason,'Kept by you.');assert.equal(result.decisions[1].original_reason,'A note to subscribers.');assert.equal(result.decisions[1].original_decision,'set_aside');assert.equal(calls,1);
  const saved=JSON.parse(db.prepare('SELECT payload FROM publisher_state WHERE signup_id=4').get().payload);assert.equal(saved.journal.calls[0].reserved,.2);assert.equal(saved.journal.calls.length,2);assert.equal(saved.journal.spent,.001);
  assert(db.prepare('SELECT run_id FROM publisher_events WHERE signup_id=4 ORDER BY id DESC LIMIT 1').get().run_id.endsWith('.s1'));
  // The original set-aside events no longer belong to the current run, so change
  // selection directly to simulate another confirmed correction arriving now.
  db.prepare("UPDATE publisher_selections SET revision=2,restored_json=json_set(restored_json,'$.106','keep') WHERE signup_id=4").run();
  await assert.rejects(worker.read({posts,publication:'The Workshop',volume:'1'}),/selection changed/);assert.equal(calls,1);
});
db.close();console.log(`${n} publisher restoration checks passed`);
