// Real SQLite/version handlers and complete PDF bytes. Only the upstream store
// and Cloudflare's native streaming hasher are replaced for the Node harness.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {completeReaderMap} from './lib/complete-reader.mjs';
import {readerPages,validReaderMap,EDITION_MAX_BYTES} from '../functions/lib/edition-reader.js';
import {onRequest as file} from '../functions/api/edition-file.js';
import {onRequest as edition} from '../functions/api/edition.js';
import {onRequest as version} from '../functions/api/version.js';
import {hmacHex} from '../functions/lib/press-dispatch.js';
const dir=mkdtempSync(join(tmpdir(),'complete-reader-')),pdf=join(dir,'book.pdf');
const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.TimesRoman);
for(let n=1;n<=12;n++)doc.addPage([432,648]).drawText(n===2?'Contents':`Physical leaf ${n}: the complete original writing.`,{x:40,y:500,font,size:14});
const bytes=await doc.save();writeFileSync(pdf,bytes);
writeFileSync(pdf.replace('.pdf','.pages.json'),JSON.stringify({pages:Array.from({length:12},(_,i)=>({page:i+1})),folios:Array.from({length:9},(_,i)=>({page:i+4,folio:i+1})),articles:[{n:1,start:4,end:12}]}));
const hash=createHash('sha256').update(bytes).digest('hex'),book={pdf,report:{postOrder:[{id:1}],publisher:{decisions:[{post_id:1,kind:'essay'}]}}};
const map=completeReaderMap(book,12),key=`proofs/fixture-1/i-${hash.slice(0,12)}.pdf`,source=`https://caithrin--inksheaf-proof-store-web.modal.run/proof?key=${key}&exp=4000000000&sig=${'a'.repeat(64)}`;
let count=0;async function test(name,fn){await fn();count++;console.log('PASS',name);}
await test('all physical leaves and real printed labels survive without changing PDF bytes',()=>{
 const pages=readerPages(map,12);assert.equal(pages.length,12);assert.equal(pages[1].label,'Contents');assert.equal(pages[7].label,'Page 5');assert.equal(pages[11].label,'Page 9');assert.equal(pages[7].text_mode,'prose');assert.deepEqual(readFileSync(pdf),Buffer.from(bytes));
 assert.deepEqual(map.folios,[[4,12,1]]);assert(!validReaderMap({...map,folios:[[4,12,1],[8,12,2]]},12));assert(!validReaderMap({...map,labels:[[5,'fake']]},12));
});
const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
db.exec("INSERT INTO signups (id,publication_url,email,raw_json,plan_json) VALUES (1,'https://fixture.substack.com','owner@example.com','{}','{}')");
const DB={prepare(sql){const q=db.prepare(sql);let args=[];return {bind(...v){args=v;return this;},async first(){return q.get(...args)||null;},async all(){return {results:q.all(...args)};},async run(){const r=q.run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};}};
const env={DB,ARCHIVE_RELAY_TOKEN:'fixture'},sig=await hmacHex('fixture','edition:1');
const volumes=[1,2].map(i=>({label:'Volume '+i,pages:12,key,sha256:hash,reader_map:map}));
const record={signup_id:1,sig:await hmacHex('fixture','version:1'),plan_json:{},post_ids:[1],body_hashes:{1:'frozen'},renderer_sha:'fixture',print_mode:'bw',volumes,proof_key:key,proof_sha256:hash,pages:24,run_id:'fixture'};
const post=body=>version({env,request:new Request('https://inksheaf.com/api/version',{method:'POST',body:JSON.stringify(body)})});
const {version_id}=await(await post(record)).json();
const ready={kind:'ready',version_id,selection_revision:0,files:volumes.map(v=>({label:v.label,pages:v.pages,url:source})),expires_at:new Date(4000000000000).toISOString(),pages:24};
const save=(e=ready)=>db.prepare("UPDATE publisher_events SET payload=? WHERE signup_id=1 AND run_id='fixture.1' AND sequence=1").run(JSON.stringify(e));
db.prepare("INSERT INTO publisher_events (signup_id,run_id,sequence,kind,payload) VALUES (1,'fixture.1',1,'ready',?)").run(JSON.stringify(ready));
const request=(extra='')=>new Request(`https://inksheaf.com/api/edition-file?id=1&sig=${sig}&run=fixture.1&sequence=1&version=${version_id}&volume=1${extra}`);
const oldFetch=globalThis.fetch,oldDigest=crypto.DigestStream;
crypto.DigestStream=class extends WritableStream{constructor(){const hash=createHash('sha256');let resolve,reject;const digest=new Promise((a,b)=>{resolve=a;reject=b;});super({write:x=>{hash.update(x);},close:()=>resolve(hash.digest()),abort:reject});this.digest=digest;}};
let fetched=0,upstream=()=>new Response(bytes,{headers:{'content-type':'application/pdf','content-length':String(bytes.length)}});
globalThis.fetch=async(url,options)=>{fetched++;assert.equal(String(url),source);assert.equal(options.redirect,'manual');return upstream();};
try{
 await test('workspace exposes every volume through same-origin links bound to the version',async()=>{
  const before=db.prepare('SELECT total_changes() n').get().n;
  const r=await edition({env,request:new Request(`https://inksheaf.com/api/edition?id=1&sig=${sig}`)}),data=await r.json(),e=data.events[0];
  assert.equal(e.reader.length,2);assert.equal(e.reader[1].pages[11].label,'Page 9');assert(e.reader.every(v=>v.complete&&v.version_id===version_id&&v.pages.length===12));assert(!JSON.stringify(data).includes('modal.run'));assert.match(e.files[1].url,/volume=2&download=1$/);assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
 });
 await test('stream completes only with the exact original digest and no database writes',async()=>{
  const before=db.prepare('SELECT total_changes() n').get().n,r=await file({env,request:request()});assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('content-length'),String(bytes.length));assert.equal(r.headers.get('x-content-sha256'),hash);assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
  const second=await file({env,request:new Request(request('&download=1').url.replace('volume=1','volume=2'))});assert.match(second.headers.get('content-disposition'),/attachment; filename="volume-2.pdf"/);await second.arrayBuffer();
 });
 await test('wrong capability, method, version, run, sequence and volume never fetch a PDF',async()=>{
  const before=fetched;
  for(const [from,to,status] of [['id=1','id=2',403],[`version=${version_id}`,'version=999',409],['run=fixture.1','run=stale',409],['sequence=1','sequence=2',409],['volume=1','volume=3',409]])assert.equal((await file({env,request:new Request(request().url.replace(from,to))})).status,status);
  assert.equal((await file({env,request:new Request(request().url,{method:'POST'})})).status,405);assert.equal(fetched,before);
 });
 await test('fragmented transfers preserve every byte across header and final-byte boundaries',async()=>{
  for(const chunkSize of [1,7,63,64,65,1024]){
   let offset=0;upstream=()=>new Response(new ReadableStream({pull(c){if(offset===bytes.length){c.close();return;}const end=Math.min(bytes.length,offset+chunkSize);c.enqueue(bytes.slice(offset,end));offset=end;}}),{headers:{'content-type':'application/pdf','content-length':String(bytes.length)}});
   const r=await file({env,request:request()});assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);
  }
 });
 await test('expired, malformed and differently bound ready files cannot be renewed by reading',async()=>{
  const before=fetched;
  for(const changed of [{...ready,version_id:999},{...ready,selection_revision:1},{...ready,files:[ready.files[0]]},{...ready,files:ready.files.map(f=>({...f,url:f.url.replace('/proof?','/checkpoint?')}))},{...ready,files:ready.files.map(f=>({...f,url:f.url.replace('fixture-1','other-owner')}))}]){save(changed);assert.equal((await file({env,request:request()})).status,409);}
  save({...ready,expires_at:'2001-01-01T00:00:00Z',files:ready.files.map(f=>({...f,url:f.url.replace('4000000000','900000000')}))});assert.equal((await file({env,request:request()})).status,410);assert.equal(fetched,before);save();
 });
 await test('redirects, missing length, wrong type and excessive advertised size are refused',async()=>{
  for(const make of [()=>new Response('',{status:302,headers:{location:'https://elsewhere.example'}}),()=>new Response(bytes),()=>new Response(bytes,{headers:{'content-type':'application/pdf'}}),()=>new Response(bytes,{headers:{'content-type':'application/pdf','content-length':String(EDITION_MAX_BYTES+1)}})]){upstream=make;assert.equal((await file({env,request:request()})).status,502);}
 });
 await test('altered, short, oversized and disconnected bodies never produce successful EOF',async()=>{
  for(const make of [()=>new Response(bytes.slice(0,-1),{headers:{'content-type':'application/pdf','content-length':String(bytes.length)}}),()=>new Response(bytes,{headers:{'content-type':'application/pdf','content-length':String(bytes.length-1)}}),()=>{const wrong=bytes.slice();wrong[10]^=1;return new Response(wrong,{headers:{'content-type':'application/pdf','content-length':String(bytes.length)}});},()=>new Response(new ReadableStream({start(c){c.enqueue(bytes.subarray(0,12));c.error(Error('disconnected'));}}),{headers:{'content-type':'application/pdf','content-length':String(bytes.length)}})]){upstream=make;const r=await file({env,request:request()});assert.equal(r.status,200);await assert.rejects(r.arrayBuffer());}
 });
 await test('selection, version, ready-event and worker changes during transfer retire the response',async()=>{
  const alterations=[()=>db.exec('INSERT INTO publisher_selections (signup_id,revision) VALUES (1,1)'),()=>db.exec("UPDATE edition_versions SET status='superseded' WHERE id=1"),()=>db.exec("INSERT INTO publisher_events (signup_id,run_id,sequence,kind,payload) VALUES (1,'fixture.2',1,'identity','{}')"),()=>db.prepare("INSERT INTO publisher_events (signup_id,run_id,sequence,kind,payload) VALUES (1,'fixture.1',2,'ready',?)").run(JSON.stringify(ready))];
  for(const alter of alterations){upstream=()=>{alter();return new Response(bytes,{headers:{'content-type':'application/pdf','content-length':String(bytes.length)}});};const r=await file({env,request:request()});assert.equal(r.status,200);await assert.rejects(r.arrayBuffer());db.exec("DELETE FROM publisher_selections; DELETE FROM publisher_events WHERE id>1; UPDATE edition_versions SET status='proofed' WHERE id=1");}
 });
 await test('oversized version metadata is refused before recording or superseding anything',async()=>{
  const before=db.prepare('SELECT total_changes() n').get().n;assert.equal((await post({...record,volumes:[{long:'x'.repeat(100001)}]})).status,413);assert.equal((await post({...record,volumes:'not JSON'})).status,400);assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
 });
 await test('a larger divided edition keeps its complete volume metadata instead of truncating JSON',async()=>{
  const larger=volumes.map(v=>({...v,postOrder:Array.from({length:60},(_,i)=>({id:i,title:'Original source title '.repeat(12)}))}));
  assert(JSON.stringify(larger).length>20000);const r=await post({...record,volumes:larger});assert.equal(r.status,200);const {version_id:newId}=await r.json();assert.deepEqual(JSON.parse(db.prepare('SELECT volumes FROM edition_versions WHERE id=?').get(newId).volumes),larger);
 });
}finally{globalThis.fetch=oldFetch;if(oldDigest)crypto.DigestStream=oldDigest;else delete crypto.DigestStream;db.close();}
console.log(`${count} complete edition reader checks passed`);
