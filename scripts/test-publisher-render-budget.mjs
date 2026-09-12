// No external effects. Real journal files, SQLite API handlers, killed child
// processes and the actual fitter/render script exercise the durable boundary.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync,rmSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHmac,createHash} from 'node:crypto';
import {z} from 'zod';
import {publisherSession,publisherReviewCacheKey} from './lib/publisher-session.mjs';
import {PUBLISHER_MODELS} from './lib/publisher-agent.mjs';
import {fitWithBudget,fit} from './lib/fit.mjs';
import {onRequest as stateApi} from '../functions/api/publisher-state.js';
import {onRequest as eventApi} from '../functions/api/publisher-event.js';
import {newRenderBudget} from '../functions/lib/publisher-render-budget.js';

let passed=0;
const directories=[];
const temporary=()=>{const dir=mkdtempSync(join(tmpdir(),'publisher-budget-'));directories.push(dir);return dir;};
const read=dir=>JSON.parse(readFileSync(join(dir,'state.json'),'utf8'));
const offline=()=>{throw Error('Unexpected external request');};
const local=dir=>publisherSession({directory:dir,env:{},fetchImpl:offline});
async function test(name,run){await run();passed++;console.log('PASS',name);}
const killAfterSaved=async code=>{
  const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
  let error='';child.stderr.on('data',data=>error+=data);
  const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));});
  assert.equal(result.signal,'SIGKILL',error);
};

try{
await test('a killed process retains its reserved render and the restart stops at six',async()=>{
  const dir=temporary();
  await killAfterSaved(`import {publisherSession} from './scripts/lib/publisher-session.mjs'; const s=await publisherSession({directory:${JSON.stringify(dir)},env:{}}); await s.reserveRender('1',{pass:1}); process.kill(process.pid,'SIGKILL');`);
  assert.equal((await local(dir)).renderUsage('1').passes,1);
  for(let i=1;i<6;i++)await(await local(dir)).reserveRender('1',{pass:i+1});
  const original=readFileSync(join(dir,'state.json'),'utf8');
  await assert.rejects((await local(dir)).reserveRender('1',{}),{code:'PUBLISHER_RENDER_BUDGET_REACHED'});
  assert.equal(readFileSync(join(dir,'state.json'),'utf8'),original);
  assert.equal((await local(dir)).renderUsage('2').passes,0);
  await(await local(dir)).reserveRender('2',{});
  assert.equal(read(dir).renderBudget.volumes['1'].passes.length,6);
});

await test('two local workers cannot spend the last pass or erase one another',async()=>{
  const dir=temporary();for(let i=0;i<5;i++)await(await local(dir)).reserveRender('1',{pass:i});
  const a=await local(dir),b=await local(dir);
  const results=await Promise.allSettled([a.reserveRender('1',{}),b.reserveRender('1',{})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/another worker/);
  assert.equal(read(dir).renderBudget.volumes['1'].passes.length,6);
});

await test('a killed inference retains its unknown charge and render count',async()=>{
  const dir=temporary();await(await local(dir)).reserveRender('1',{});
  await killAfterSaved(`import {publisherSession} from './scripts/lib/publisher-session.mjs'; const s=await publisherSession({directory:${JSON.stringify(dir)},env:{OPENROUTER_API_KEY:'fixture'},fetchImpl:async()=>{process.kill(process.pid,'SIGKILL');}}); await s.layout({pdf_hash:'fixture',pages:[{page:1,findings:[],printed_text:'A poem.',unused_body_fraction_lower_bound:.8}],candidates:[]});`);
  const saved=read(dir);assert.equal(saved.journal.calls.length,1);assert.equal(saved.journal.calls[0].status,'reserved');assert(saved.journal.calls[0].reserved>0);
  await(await local(dir)).reserveRender('1',{});
  assert.deepEqual(read(dir).journal,saved.journal);
  assert.equal(read(dir).renderBudget.volumes['1'].passes.length,2);
});

await test('legacy journals and interrupted locks cannot silently get a new allowance',async()=>{
  const dir=temporary(),legacy={journal:{calls:[{id:'old',reserved:1.9}],spent:0},cache:[],runs:{}};
  writeFileSync(join(dir,'state.json'),JSON.stringify(legacy));
  await assert.rejects((await local(dir)).reserveRender('1',{}),{code:'PUBLISHER_RENDER_HISTORY_UNKNOWN'});
  assert.deepEqual(read(dir),legacy);
  const locked=temporary();writeFileSync(join(locked,'state.json.lock'),'');
  await assert.rejects((await local(locked)).reserveRender('1',{}),/locked/);
  assert(!existsSync(join(locked,'state.json')));
});

await test('repair rounds persist and cannot be reset by another session',async()=>{
  const dir=temporary();await(await local(dir)).reserveRepair('1',{leading:.62});
  await(await local(dir)).reserveRepair('1',{leading:.58});
  await assert.rejects((await local(dir)).reserveRepair('1',{}),{code:'PUBLISHER_RENDER_BUDGET_REACHED'});
  assert.equal((await local(dir)).renderUsage('1').repairs,2);
});

const db=new DatabaseSync(':memory:');
for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+file,'utf8'));
const DB={prepare(sql){const q=db.prepare(sql);let args=[];return{bind(...values){args=values;return this;},async first(){return q.get(...args)||null;},async all(){return{results:q.all(...args)};},async run(){return{meta:{changes:Number(q.run(...args).changes)}};}};}};
const env={DB,ARCHIVE_RELAY_TOKEN:'fixture'};
const seed=id=>db.prepare("INSERT INTO signups (id,publication_url,email,raw_json) VALUES (?,'https://writer.substack.com','owner@example.com','{}')").run(id);
const workerEnv=id=>({SIGNUP_ID:String(id),SITE_BASE:'https://isolated.invalid',ARCHIVE_RELAY_TOKEN:'fixture',GITHUB_RUN_ID:'test',OPENROUTER_API_KEY:'fixture'});
const transport=async(url,options)=>{
  assert.equal(new URL(url).origin,'https://isolated.invalid');
  const request=new Request(url,options);
  if(new URL(url).pathname==='/api/publisher-state')return stateApi({request,env});
  if(new URL(url).pathname==='/api/publisher-event')return eventApi({request,env});
  throw Error('Unexpected endpoint');
};
const remote=(id,fetchImpl=transport,directory=temporary())=>publisherSession({directory,env:workerEnv(id),fetchImpl});
const saved=id=>JSON.parse(db.prepare('SELECT payload FROM publisher_state WHERE signup_id=?').get(id).payload);

await test('remote CAS admits only one competing final render',async()=>{
  seed(1);for(let i=0;i<5;i++)await(await remote(1)).reserveRender('1',{pass:i});
  const a=await remote(1),b=await remote(1);
  const results=await Promise.allSettled([a.reserveRender('1',{}),b.reserveRender('1',{})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(saved(1).renderBudget.volumes['1'].passes.length,6);
});

await test('lost save acknowledgement preserves the reservation and starts no builder',async()=>{
  seed(2);let lose=true,started=false;
  const fetchImpl=async(url,options)=>{const response=await transport(url,options);if(lose&&options?.method==='POST'){lose=false;throw Error('Lost save acknowledgement');}return response;};
  const worker=await remote(2,fetchImpl);
  await assert.rejects(async()=>{await worker.reserveRender('1',{});started=true;},/Lost save/);
  assert.equal(started,false);assert.equal((await remote(2)).renderUsage('1').passes,1);
});

await test('database failure prevents work and remote selection changes share the allowance',async()=>{
  seed(3);let started=false;
  const fetchImpl=(url,options)=>options?.method==='POST'?Promise.resolve(Response.json({ok:false},{status:503})):transport(url,options);
  await assert.rejects(async()=>{await(await remote(3,fetchImpl)).reserveRender('1',{});started=true;},/could not be saved/);
  assert.equal(started,false);assert.equal(db.prepare('SELECT count(*) n FROM publisher_state WHERE signup_id=3').get().n,0);
  const old=await remote(3);await old.reserveRender('1',{});await old.reserveRepair('1',{});
  db.prepare("INSERT INTO publisher_selections (signup_id,revision,restored_json) VALUES (3,1,'{}')").run();
  await assert.rejects(old.reserveRender('1',{}),{code:'PUBLISHER_SELECTION_CHANGED'});
  const current=await remote(3);assert.deepEqual(current.renderUsage('1'),{passes:1,repairs:1});
  await current.reserveRender('1',{});assert.equal(saved(3).renderBudget.volumes['1'].passes[1].selection_revision,1);
});

const postState=async(id,next)=>{
  const revision=db.prepare('SELECT revision FROM publisher_state WHERE signup_id=?').get(id)?.revision||0;
  const payload=JSON.stringify(next),sig=createHmac('sha256','fixture').update(`publisher-state:${id}:${revision}:${payload}`).digest('hex');
  return stateApi({request:new Request('https://isolated.invalid/api/publisher-state',{method:'POST',body:JSON.stringify({signup_id:id,revision,state:next,sig})}),env});
};
await test('a current-revision state write still cannot delete, reduce or mutate reservations',async()=>{
  const original=saved(3);
  for(const change of [s=>delete s.renderBudget,s=>s.renderBudget=newRenderBudget(),s=>s.renderBudget.volumes['1'].passes.pop(),s=>s.renderBudget.volumes['1'].passes[0].settings_hash='b'.repeat(64),s=>s.renderBudget.volumes['1'].passes.push(...Array(6).fill(s.renderBudget.volumes['1'].passes[0]))]){
    const next=structuredClone(original);change(next);assert.equal((await postState(3,next)).status,400);assert.deepEqual(saved(3),original);
  }
  seed(4);const legacy={journal:{calls:[{id:'old',reserved:.2}],spent:0},cache:[],runs:{}};
  assert.equal((await postState(4,legacy)).status,200);
  assert.equal((await postState(4,{...legacy,renderBudget:newRenderBudget()})).status,409);
  await assert.rejects((await remote(4)).reserveRender('1',{}),{code:'PUBLISHER_RENDER_HISTORY_UNKNOWN'});
});
db.close();

await test('review keys change for schema, prompt, model, source, renderer policy and image bytes',async()=>{
  const request={model:PUBLISHER_MODELS.reader.id,task:'Inspect.',schema:z.object({ok:z.boolean()}),input:{source:'original'},imageHashes:['a'.repeat(64)],maxTokens:1000};
  const key=publisherReviewCacheKey(request);assert.equal(key,publisherReviewCacheKey({...request}));
  for(const change of [{schema:z.object({ok:z.boolean(),reason:z.string()})},{task:'Inspect differently.'},{model:PUBLISHER_MODELS.publisher.id},{input:{source:'revised'}},{policy:'new-renderer-policy'},{imageHashes:['b'.repeat(64)]},{maxTokens:2000}])assert.notEqual(key,publisherReviewCacheKey({...request,...change}));
});

await test('old image-only cache keys are ignored while current identical review reuses its charge',async()=>{
  const dir=temporary(),image=join(dir,'page.png');
  const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(10,16);png.writeUInt32BE(10,20);writeFileSync(image,png);
  const text='Review page one.',model=PUBLISHER_MODELS.reader.id;
  const oldKey=createHash('sha256').update(JSON.stringify([model,text,[createHash('sha256').update(png).digest('hex')]])).digest('hex');
  writeFileSync(join(dir,'state.json'),JSON.stringify({journal:{calls:[],spent:0},cache:[[oldKey,[{page:1,check:1,note:'Stale',confidence:1}]]],runs:{},renderBudget:newRenderBudget()}));
  let calls=0;const fetchImpl=async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:'{"findings":[]}'}}],usage:{cost:.001}});};
  const session=()=>publisherSession({directory:dir,env:{OPENROUTER_API_KEY:'fixture'},fetchImpl});
  const request={model,text,images:[image],maxTokens:1000};
  assert.equal((await(await session()).vision(request)).text,'[]');
  assert.equal((await(await session()).vision(request)).text,'[]');assert.equal(calls,1);assert.equal(read(dir).journal.calls.length,1);
  assert(read(dir).cache.some(([key])=>key===oldKey));
});

const longConfirmation='The paragraph beginning on page 38 ends with only two lines at the top of page 39 before the next paragraph starts, but the metadata shows just a two-line remainder—borderline, not a true single-line widow.';
assert(longConfirmation.length>200);
for(const mode of ['corrected','invalid-again','call-cap'])await test(`schema correction is bounded and charged: ${mode}`,async()=>{
  const dir=temporary(),image=join(dir,'page.png'),png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(10,16);png.writeUInt32BE(10,20);writeFileSync(image,png);
  if(mode==='call-cap')writeFileSync(join(dir,'state.json'),JSON.stringify({journal:{calls:Array.from({length:255},(_,id)=>({id:String(id),cost:0,reserved:0,status:'completed'})),spent:0},cache:[],runs:{},renderBudget:newRenderBudget()}));
  let calls=0;
  const s=await publisherSession({directory:dir,env:{OPENROUTER_API_KEY:'fixture'},fetchImpl:async(url,options)=>{
    calls++;const request=JSON.parse(options.body);assert.equal(request.max_tokens,400);assert.deepEqual(request.reasoning,{enabled:false});
    if(calls===2)assert(JSON.stringify(request.messages).includes('previous response failed schema validation'));
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(calls===2&&mode==='corrected'?{confirmed:false,origin:'rendered_layout',note:'Two continuation lines are not a single-line widow.'}:{confirmed:true,origin:'rendered_layout',note:longConfirmation})}}],usage:{cost:.001}});
  }});
  const request={model:PUBLISHER_MODELS.publisher.id,images:[image],text:'Confirm the actual page boundary.',maxTokens:400};
  if(mode==='corrected'){
    assert.equal(JSON.parse((await s.vision(request)).text).confirmed,false);await s.vision(request);assert.equal(calls,2);
    assert.deepEqual(read(dir).journal.calls.map(c=>c.status),['failed','completed']);assert.equal(read(dir).journal.spent,.002);assert.equal(read(dir).cache.length,1);
  }else{
    await assert.rejects(s.vision(request),mode==='call-cap'?/model budget reached/:/Too big/);
    assert.equal(calls,mode==='call-cap'?1:2);assert.equal(read(dir).journal.calls.length,mode==='call-cap'?256:2);assert.equal(read(dir).cache.length,0);
  }
});

await test('page-break confirmation requests its typed schema and retries an untyped answer before caching',async()=>{
  const dir=temporary(),image=join(dir,'page.png'),png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(10,16);png.writeUInt32BE(10,20);writeFileSync(image,png);
  let calls=0;
  const answer={confirmed:false,origin:'rendered_layout',note:'Two lines continue normally.',defect:'none',edge:'top'};
  const s=await publisherSession({directory:dir,env:{OPENROUTER_API_KEY:'fixture'},fetchImpl:async(url,options)=>{
    calls++;const request=JSON.parse(options.body),schema=request.response_format.json_schema.schema;
    assert(schema.required.includes('defect')&&schema.required.includes('edge'));assert.equal(request.max_tokens,400);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(calls===1?{confirmed:true,origin:'rendered_layout',note:'Untyped interpretation.'}:answer)}}],usage:{cost:.001}});
  }});
  const request={model:PUBLISHER_MODELS.publisher.id,images:[image],text:'Confirm the printed paragraph boundary.',maxTokens:400,check:2};
  assert.deepEqual(JSON.parse((await s.vision(request)).text),answer);await s.vision(request);assert.equal(calls,2);
  assert.deepEqual(read(dir).journal.calls.map(c=>c.status),['failed','completed']);assert.equal(read(dir).cache.length,1);
});

await test('layout reserves answer space and retains a truncated charge across restart without caching its partial verdict',async()=>{
  const dir=temporary();let calls=0;
  const input={pdf_hash:'fixture',pages:Array.from({length:6},(_,i)=>({page:i+1,findings:[],position:'complete short piece',printed_text:'A complete short poem.',unused_body_fraction_lower_bound:.8})),candidates:[]};
  const decisions=input.pages.map(p=>({page:p.page,decision:'intentional_space',candidate_id:null,reason:'The complete short poem occupies its own page.'}));
  const session=()=>publisherSession({directory:dir,env:{OPENROUTER_API_KEY:'fixture'},fetchImpl:async(url,options)=>{
    calls++;const request=JSON.parse(options.body);assert.equal(request.max_tokens,2500);assert.deepEqual(request.reasoning,{enabled:false});
    // Preserve the live failure shape even if a provider ignores the requested
    // thinking budget: a partial JSON answer cannot become quality acceptance.
    return Response.json({choices:[{finish_reason:calls===1?'length':'stop',message:{content:calls===1?'{"decisions":[':JSON.stringify({decisions})}}],usage:calls===1?{cost:.107472,completion_tokens:5000,completion_tokens_details:{reasoning_tokens:4695}}:{cost:.001}});
  }});
  await assert.rejects((await session()).layout(input),/response was incomplete/);
  assert.equal(calls,1);assert.equal(read(dir).cache.length,0);assert.equal(read(dir).journal.spent,.107472);
  assert.deepEqual(await(await session()).layout(input),{decisions});
  await(await session()).layout(input);assert.equal(calls,2);
  assert.deepEqual(read(dir).journal.calls.map(c=>c.status),['failed','completed']);
  assert(Math.abs(read(dir).journal.spent-.108472)<1e-12);
});

await test('the real fitter saves before its builder, renders a PDF, and retains the count on restart',async()=>{
  mkdirSync('proofs',{recursive:true});const dir=mkdtempSync(resolve('proofs/publisher-budget-test-'));directories.push(dir);
  const builder=join(dir,'builder.mjs'),html=join(dir,'book.html'),pdf=join(dir,'book.pdf'),ledger=join(dir,'journal'),marker=join(dir,'builder-started');
  const typst='#set page(width: 6in, height: 9in, margin: 1in)\n#set text(font: "Source Serif 4", size: 10.5pt)\n#context [#metadata((n: 1, page: here().page())) <artstart>]\nA short complete source for the render accounting test.\n#context [#metadata((n: 1, page: here().page())) <artend>]\n';
  writeFileSync(builder,`import {readFileSync,writeFileSync} from 'node:fs'; const state=JSON.parse(readFileSync(${JSON.stringify(join(ledger,'state.json'))},'utf8')); if(!state.renderBudget.volumes['1'].passes.length)throw Error('Unreserved builder'); writeFileSync(${JSON.stringify(marker)},'started'); writeFileSync(${JSON.stringify(html)},'fixture');writeFileSync(${JSON.stringify(html.replace('.html','.typ'))},${JSON.stringify(typst)});writeFileSync(${JSON.stringify(html.replace('.html','.report.json'))},JSON.stringify({printInterior:true}));`);
  const options={args:[builder],html,pdf,passes:1};
  await assert.rejects(fitWithBudget({...options,beforePass:async()=>{throw Error('reservation denied');}}),/reservation denied/);
  assert(!existsSync(marker));
  const oldEngine=process.env.BOOK_ENGINE;process.env.BOOK_ENGINE='typst';
  try{
    const result=await fitWithBudget({...options,beforePass:async settings=>await(await local(ledger)).reserveRender('1',settings)});
    assert.equal(result.pass,1);assert(existsSync(pdf));assert.equal((await local(ledger)).renderUsage('1').passes,1);
    // Preserve the synchronous caller contract on the same known-safe fixture.
    const legacy=fit(options);assert.equal(legacy.pass,1);assert.equal(typeof legacy.then,'undefined');
  }finally{if(oldEngine==null)delete process.env.BOOK_ENGINE;else process.env.BOOK_ENGINE=oldEngine;}
});
console.log(`${passed} durable publisher budget/cache checks passed (no paid inference or external effects)`);
}finally{for(const dir of directories)rmSync(dir,{recursive:true,force:true});}
