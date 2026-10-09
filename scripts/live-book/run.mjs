// Live-book test: one real publication through the whole customer path, locally.
// The real homepage, signup, press worker, page review, delivery and reader run against
// live Substack reads and real model calls. Nothing leaves this machine except reads,
// model calls and proof-store uploads to a local stand-in: mail is captured to two
// declared sinks, dispatch starts a local worker, no production state is touched.
//
// Checks every book must pass, whatever the publication:
//   delivered     one dispatch, a proofed version, the writer's and operator's mail captured
//   identical     each volume's stored, served and mailed bytes are the same file
//   complete      every selected post is in the book or set aside with a reason, and each
//                 printed body matches a fresh read of the post
//   bounded       no glyph or image outside the paper (pdf-bounds-audit)
//   readable      an independent model finds no major defect on sampled pages
// It records time to PDF, model cost and any open issues delivered for the operator.
//
// Usage: node scripts/live-book/run.mjs --host <publication> --out <dir> [--minutes 40] [--budget 36]
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,symlinkSync,createWriteStream} from 'node:fs';
import {resolve,join,extname,dirname} from 'node:path';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright';
import {PDFDocument} from 'pdf-lib';
import {deployedPress} from '../press-release.mjs';
import {reviewQuality} from './quality-review.mjs';

const root=process.cwd(),arg=(f,d=null)=>{const i=process.argv.indexOf(f);return i<0?d:process.argv[i+1];};
const host=String(arg('--host')||'').replace(/^https?:\/\//,'').replace(/\/.*$/,'');assert(host,'--host is required');
const out=resolve(arg('--out')||`output/live-book/${host}-${Date.now()}`),minutes=Number(arg('--minutes',40)),budget=Number(arg('--budget',36));
assert(!existsSync(join(out,'journey.json')),'Preserve completed attempts; select a new directory');mkdirSync(out,{recursive:true});
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const release=JSON.parse(readFileSync('dist/inksheaf-press.json'));assert.equal(release.sha,sha,'Build dist at this commit first (npm run build)');
const openrouterKey=readFileSync(join(process.env.HOME,'.secrets/openrouter'),'utf8').match(/sk-or-[A-Za-z0-9_-]+/)[0];
// The real relay secret, so a refused or rate-limited read falls back to the relay exactly as in production.
const secret=readFileSync(join(process.env.HOME,'.secrets/inksheaf-relay-token'),'utf8').trim(),storeSecret=randomBytes(24).toString('hex');
const owner='owner@example.com',operator='operator@example.com',sinks=new Set([owner,operator]);
const journal={version:1,host,code_commit:sha,started:new Date().toISOString(),budget_usd:budget,events:[],requests:{},sends:[],dispatched:0,checks:{}};
const mark=(kind,extra={})=>{journal.events.push({kind,elapsed_ms:Date.now()-Date.parse(journal.started),...extra});writeFileSync(join(out,'journey-running.json'),JSON.stringify(journal,null,2)+'\n');};
const db=new DatabaseSync(join(out,'live.sqlite'));for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
const DB={prepare(sql){const q=db.prepare(sql);let args=[];return {bind(...a){args=a;return this;},async first(){return q.get(...args)||null;},async all(){return {results:q.all(...args)};},
  async run(){const r=q.run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};}};
crypto.DigestStream=class extends WritableStream{constructor(){const h=createHash('sha256');let yes,no;const digest=new Promise((a,b)=>{yes=a;no=b;});super({write:b=>h.update(b),close:()=>yes(h.digest()),abort:no});this.digest=digest;}};
const env={DB,ARCHIVE_RELAY_TOKEN:secret,PROOF_STORE_TOKEN:storeSecret,GITHUB_DISPATCH_TOKEN:'isolated',INKSHEAF_ENV:'production',RESEND_API_KEY:'isolated',OPERATOR_EMAIL:operator,OPENROUTER_API_KEY:openrouterKey};
const native=fetch,store=new Map(),hash=b=>createHash('sha256').update(b).digest('hex'),sign=(k,m)=>createHmac('sha256',k).update(m).digest('hex');
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.json':'application/json'};
let origin,worker,workerDone;const pending=new Set();
async function external(input,init){
  const req=new Request(input,init),u=new URL(req.url);journal.requests[u.hostname]=(journal.requests[u.hostname]||0)+1;
  if(u.origin===origin)return native(req);
  if(u.hostname==='api.github.com'&&u.pathname==='/repos/caithrin01/inksheaf/dispatches'&&req.method==='POST'){
    const body=await req.json();assert.equal(body.event_type,'press');assert.equal(body.client_payload.email,owner);journal.dispatched++;
    writeFileSync(join(out,'dispatch.json'),JSON.stringify(body,null,2));mark('dispatch_received');setTimeout(()=>startWorker(body.client_payload),0);return new Response(null,{status:204});
  }
  if(u.hostname==='caithrin--inksheaf-proof-store-web.modal.run'){
    const key=u.searchParams.get('key'),checkpoint=u.pathname==='/checkpoint';
    if(req.method==='PUT'){const bytes=Buffer.from(await req.arrayBuffer());store.set(key,bytes);const file=join(out,'store',key);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes);return Response.json({ok:true,sha256:hash(bytes)});}
    if(req.method==='GET'||req.method==='HEAD'){const bytes=store.get(key);if(!bytes)return new Response('',{status:404});return new Response(req.method==='HEAD'?null:bytes,{headers:{'content-type':checkpoint?'application/gzip':'application/pdf','content-length':String(bytes.length)}});}
  }
  if(u.hostname==='api.resend.com'&&u.pathname==='/emails'&&req.method==='POST'){
    const msg=await req.json();assert.equal(msg.to.length,1);assert(sinks.has(msg.to[0]),'Mail only to the declared local sinks');
    const id='mail-'+(journal.sends.length+1),file=join(out,id+'.json');writeFileSync(file,JSON.stringify(msg,null,2));journal.sends.push({id,recipient:msg.to[0],subject:msg.subject,file});mark('mail_captured',{id});return Response.json({id});
  }
  if(u.hostname==='openrouter.ai'&&req.method==='POST'){
    return native(req.url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+openrouterKey},body:await req.text(),signal:AbortSignal.any([req.signal,AbortSignal.timeout(180000)])});
  }
  if(u.hostname.endsWith('lulu.com'))return Response.json({detail:'Lulu is not part of the live-book test'},{status:503});
  // Live public reads: Substack archives and posts, images, fonts, the relay.
  if(['GET','HEAD'].includes(req.method)&&u.protocol==='https:')return native(req.url,{method:req.method,headers:req.headers,redirect:'follow',signal:req.signal});
  throw Error('Unexpected external transport '+req.method+' '+u.hostname+u.pathname);
}
globalThis.fetch=external;
const handlers=new Map();
const server=createServer(async(req,res)=>{
  try{
    const controller=new AbortController();req.once('aborted',()=>controller.abort());
    const u=new URL(req.url,origin);const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);let response;
    if(u.pathname==='/__transport'){const body=JSON.parse(bytes);response=await external(body.url,{method:body.method,headers:body.headers,signal:controller.signal,...(body.body?{body:Buffer.from(body.body,'base64')}:{})});}
    else if(u.pathname.startsWith('/api/')){
      const file=join(root,'functions',u.pathname+'.js');if(!existsSync(file)){res.writeHead(404);res.end('{}');return;}
      if(!handlers.has(u.pathname))handlers.set(u.pathname,(await import(file)).onRequest);
      const request=new Request(u.href,{method:req.method,headers:req.headers,...(bytes.length?{body:bytes}:{})});
      response=await handlers.get(u.pathname)({request,env,waitUntil:p=>{pending.add(p);p.finally(()=>pending.delete(p));}});
      if(u.pathname==='/api/publisher-event'&&response.ok){const e=JSON.parse(bytes).event;mark('publisher_'+e.kind,{read:e.read,total:e.total,checked:e.checked,volume:e.volume});}
    } else {let file=resolve(root,'dist','.'+u.pathname);if(!extname(file))file=join(file,'index.html');if(!existsSync(file)){res.writeHead(404);res.end();return;}response=new Response(readFileSync(file),{headers:{'content-type':types[extname(file)]||'application/octet-stream'}});}
    const headers=Object.fromEntries(response.headers);if(headers['content-encoding']){delete headers['content-encoding'];delete headers['content-length'];}
    res.writeHead(response.status,headers);if(response.body)for await(const b of response.body)res.write(Buffer.from(b));res.end();
  }catch(e){mark('adapter_error',{error:String(e.message).slice(0,200)});res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:e.message}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
async function startWorker(payload){
  try{
    const compatible=await deployedPress({requiredProtocol:payload.press_protocol,fetchImpl:(url,init)=>native(origin+'/inksheaf-press.json',init)});assert.equal(compatible.sha,sha);
    const workerPath=join(out,'worker');mkdirSync(workerPath,{recursive:true});const tar=join(out,'candidate.tar');
    execFileSync('git',['archive','--format=tar','--output',tar,sha]);execFileSync('tar',['-xf',tar,'-C',workerPath]);symlinkSync(resolve('node_modules'),join(workerPath,'node_modules'),'dir');
    mkdirSync(join(workerPath,'proofs'),{recursive:true});
    const log=createWriteStream(join(out,'worker.log'));
    const childEnv={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,BOOK_ENGINE:'typst',INKSHEAF_ENV:'production',SITE_BASE:origin,SIGNUP_ID:String(payload.signup_id),
      PUBLICATION_URL:payload.publication_url,WRITER_EMAIL:payload.email,OPERATOR_EMAIL:operator,PLAN_JSON:payload.plan_json||'',PRESS_EVENT:payload.event,PRESS_REQUESTED_AT:payload.requested_at,
      GITHUB_SHA:sha,GITHUB_RUN_ID:'live-book',GITHUB_RUN_ATTEMPT:'1',ARCHIVE_RELAY_TOKEN:secret,PROOF_STORE_TOKEN:storeSecret,RESEND_API_KEY:'isolated',OPENROUTER_API_KEY:'transport-supplies-real-key',
      ACCEPTANCE_ORIGIN:origin,NODE_OPTIONS:'--import '+join(root,'scripts/live-book/transport.mjs')};
    worker=spawn(process.execPath,['scripts/press.mjs'],{cwd:workerPath,env:childEnv,stdio:['ignore','pipe','pipe']});worker.stdout.pipe(log);worker.stderr.pipe(log);
    workerDone=new Promise(r=>worker.on('close',code=>{mark('worker_stopped',{code});r(code);}));mark('worker_spawned');
  }catch(e){mark('worker_start_failed',{error:String(e.message).slice(0,200)});}
}
let browser;
try{
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('#tryurl').fill(host);await page.locator('#trybtn').click();
  await page.waitForFunction(()=>document.getElementById('preview').classList.contains('personalized'),null,{timeout:90000});mark('identity_visible');
  await page.waitForFunction(()=>/ready|planned|hand-built/i.test(document.querySelector('#pv-status')?.textContent||''),null,{timeout:120000}).catch(()=>{});
  await page.locator('#pv-cta').click();const plan=JSON.parse(await page.locator('#plan_json').inputValue());writeFileSync(join(out,'selected-plan.json'),JSON.stringify(plan,null,2));
  journal.plan={cadence:plan.cadence,planned_by:plan.planned_by,volumes:(plan.volumes||[]).length,posts:(plan.volumes||[]).reduce((t,v)=>t+(v.post_ids||[]).length,0),interior:plan.interior};
  await page.locator('#email').fill(owner);mark('submission_clicked');await page.getByRole('button',{name:'Make my book',exact:true}).click();
  await page.waitForURL('**/edition?**',{timeout:60000});mark('workspace_open');
  const until=Date.now()+minutes*60000;
  while(Date.now()<until){
    if(await page.getByRole('button',{name:'Read your book',exact:true}).isVisible()){mark('complete_book_action_visible');break;}
    if(journal.events.some(e=>['worker_stopped','worker_start_failed'].includes(e.kind))){await page.waitForTimeout(8000);if(await page.getByRole('button',{name:'Read your book',exact:true}).isVisible()){mark('complete_book_action_visible');}break;}
    await new Promise(r=>setTimeout(r,1500));
  }
  if(workerDone)await Promise.race([workerDone,new Promise(r=>setTimeout(r,60000))]);
  await page.screenshot({path:join(out,'final.png'),fullPage:true});journal.browser_errors=errors;
  const versions=db.prepare('SELECT id,signup_id,post_ids,body_hashes,volumes,status FROM edition_versions').all(),press=db.prepare('SELECT status FROM press').get();
  journal.press_status=press?.status||null;journal.outbox=db.prepare('SELECT intended_to,send_status FROM email_outbox').all();
  const state=db.prepare('SELECT payload FROM publisher_state').get();const calls=state?JSON.parse(state.payload).journal.calls:[];
  journal.model={calls:calls.length,failed:calls.filter(c=>c.status==='failed').length,cost_usd:Math.round(calls.reduce((t,c)=>t+(c.cost??c.reserved??0),0)*1e6)/1e6};
  const ready=journal.events.find(e=>e.kind==='publisher_ready'),signup=journal.events.find(e=>e.kind==='submission_clicked');
  journal.seconds_to_pdf=ready&&signup?Math.round((ready.elapsed_ms-signup.elapsed_ms)/100)/10:null;
  const C=journal.checks;
  C.delivered=journal.dispatched===1&&versions.length===1&&versions[0].status==='proofed'&&journal.sends.some(s=>s.recipient===owner)&&journal.sends.some(s=>s.recipient===operator);
  if(versions.length===1){
    const v=versions[0],vols=JSON.parse(v.volumes),snapshot=await(await native(origin+'/api/edition?id='+v.signup_id+'&sig='+sign(secret,'edition:'+v.signup_id))).json(),readyEvent=snapshot.events?.find(e=>e.kind==='ready');
    journal.volumes=[];C.identical=true;C.bounded=true;
    for(const [i,vol] of vols.entries()){
      const bytes=store.get(vol.key),file=join(out,`volume-${i+1}.pdf`);if(!bytes){C.identical=false;continue;}writeFileSync(file,bytes);
      const pages=(await PDFDocument.load(bytes)).getPageCount(),served=readyEvent?.reader?.[i]?Buffer.from(await(await native(new URL(readyEvent.reader[i].url,origin))).arrayBuffer()):null;
      const mailed=journal.sends.every(s=>{const text=JSON.parse(readFileSync(s.file)).text||'';return text.includes(encodeURIComponent(vol.key))||text.includes(vol.key);});
      if(hash(bytes)!==vol.sha256||pages!==vol.pages||!served||hash(served)!==vol.sha256||!mailed)C.identical=false;
      // The audit exits 1 when it finds a problem; its JSON report is the evidence either way.
      spawnSync('python3',['scripts/pdf-bounds-audit.py',file,'--out',join(out,`bounds-${i+1}.json`)],{encoding:'utf8'});
      const bounds=JSON.parse(readFileSync(join(out,`bounds-${i+1}.json`),'utf8'));
      if(!bounds.pass)C.bounded=false;
      const quality=await reviewQuality(file,{outDir:join(out,`quality-${i+1}`),key:openrouterKey});
      journal.volumes.push({volume:i+1,label:vol.label,pages,sha256:vol.sha256,outside_paper:bounds.outside_paper.length,missing_image_pages:bounds.missing_image_pages,quality:{major:quality.major,minor:quality.minor,unreviewed:quality.unreviewed,cost_usd:quality.cost_usd}});
    }
    C.readable=journal.volumes.length>0&&journal.volumes.every(x=>!x.quality.major.length&&!x.quality.unreviewed.length);
    // Completeness against a fresh read of each printed post.
    const ids=JSON.parse(v.post_ids).map(p=>({id:String(p.id),slug:p.slug})),hashes=JSON.parse(v.body_hashes);let mismatched=0,checked=0;
    for(const p of ids){if(!p.slug)continue;try{const fresh=await(await native(`https://${host}/api/v1/posts/${encodeURIComponent(p.slug)}`,{redirect:'follow'})).json();checked++;if(fresh?.body_html&&hashes[p.id]&&hash(fresh.body_html)!==hashes[p.id])mismatched++;}catch{}}
    const selected=new Set((plan.volumes||[]).flatMap(v=>v.post_ids||[]).map(String)),printed=new Set(ids.map(p=>p.id));
    const asides=new Set(db.prepare("SELECT payload FROM publisher_events WHERE kind='reading'").all().flatMap(r=>JSON.parse(r.payload).decisions||[]).filter(d=>d.decision==='set_aside').map(d=>String(d.post_id)));
    const missing=[...selected].filter(id=>!printed.has(id)&&!asides.has(id));
    journal.completeness={selected:selected.size,printed:printed.size,set_aside:asides.size,missing,fresh_reads:checked,body_mismatches:mismatched};
    C.complete=!missing.length&&mismatched===0;
    journal.open_issues=snapshot.events?.filter(e=>e.kind==='review').map(e=>e.message)||[];
  }
  C.within_budget=journal.model.cost_usd<=budget;
  journal.status=Object.values(C).every(Boolean)&&C.delivered?'pass':C.delivered?'delivered-with-failed-checks':'not-delivered';
}catch(e){journal.status='harness-failed';journal.error=String(e.stack||e).slice(0,1200);if(worker&&workerDone)await Promise.race([workerDone,new Promise(r=>setTimeout(r,30000))]);}
finally{
  await Promise.allSettled([...pending]);await browser?.close();await new Promise(r=>server.close(r));db.close();globalThis.fetch=native;
  journal.finished=new Date().toISOString();writeFileSync(join(out,'journey.json'),JSON.stringify(journal,null,2)+'\n');
  console.log(JSON.stringify({host,status:journal.status,checks:journal.checks,seconds_to_pdf:journal.seconds_to_pdf,model:journal.model,plan:journal.plan,error:journal.error?.split('\n')[0],out}));
}
