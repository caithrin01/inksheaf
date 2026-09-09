// Real private PDF extraction and SQLite-backed access; no external uploads/calls.
import assert from 'node:assert/strict';
import {pdfPageText} from '../src/lib/pdf-page-text.js';
import {DatabaseSync} from 'node:sqlite';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {extractPublisherPreview,publishPreview,previewPages} from './lib/publisher-preview.mjs';
import {onRequest as pages} from '../functions/api/edition-pages.js';
import {onRequest as edition} from '../functions/api/edition.js';
import {onRequest as append} from '../functions/api/publisher-event.js';
import {hmacHex} from '../functions/lib/press-dispatch.js';
const dir=mkdtempSync(join(tmpdir(),'publisher-preview-')),pdf=join(dir,'book.pdf');
const source=await PDFDocument.create(),font=await source.embedFont(StandardFonts.TimesRoman);
for(let n=1;n<=8;n++){const page=source.addPage([432,648]);page.drawText(n===2?'Contents':`Unchanged source on physical leaf ${n}`,{x:50,y:540,font,size:14});}
const original=await source.save();writeFileSync(pdf,original);
writeFileSync(pdf.replace('.pdf','.pages.json'),JSON.stringify({pages:Array.from({length:8},(_,i)=>({page:i+1})),articles:[{start:4,end:8}],folios:[{page:4,folio:1},{page:5,folio:2}],figures:[{page:6},{page:7}]}));
const book={pdf,report:{pubName:'Test publication'}};
let n=0;async function test(name,fn){await fn();n++;console.log('PASS',name);}
const extracted=await extractPublisherPreview(book);
await test('recognized prose reflows while poetry keeps line breaks and all glyph text',async()=>{
 const items=[['First line',100],['continued.',88],['A new paragraph.',68]].map(([str,y])=>({str,transform:[1,0,0,1,0,y],height:10,hasEOL:true}));
 assert.deepEqual(pdfPageText(items,{reflow:true}).map(p=>p.text),['First line continued.','A new paragraph.']);
 assert.equal(pdfPageText(items)[0].text,'First line\ncontinued.\nA new paragraph.');
});

await test('preview copies actual selected leaves, their text and printed labels without changing the book',async()=>{
 assert.deepEqual(extracted.pages.map(p=>p.number),[2,4,5,6,7]);assert.equal(extracted.pages[1].label,'Page 1');
 assert.deepEqual(readFileSync(pdf),Buffer.from(original));assert.equal((await PDFDocument.load(readFileSync(extracted.file))).getPageCount(),5);
 const text=execFileSync('pdftotext',[extracted.file,'-'],{encoding:'utf8'});for(const page of [4,5,6,7])assert.match(text,new RegExp(`leaf ${page}`));assert.doesNotMatch(text,/leaf [138]/);
 assert.equal((await extractPublisherPreview(book)).sha256,extracted.sha256);
});
await test('preview selection bounds and image-only fallback are deterministic',async()=>{
 assert.deepEqual(previewPages({pages:[{page:1}]},[''],1),[{number:1,label:'Leaf 1'}]);
 assert(previewPages({articles:[{start:4}],figures:Array.from({length:80},(_,i)=>({page:i+1}))},[],80).length<=6);
 const marked=previewPages({articles:[{start:4}],publisher_marks:[{page:1},{page:20}],figures:[{page:5},{page:7},{page:9}]},[],20);assert(marked.some(p=>p.number===1));assert(marked.some(p=>p.number===20));assert(marked.some(p=>p.number===4));assert(marked.length<=6);
});
let emitted=[];const event={kind:'pages',volume:'1',round:0,draft:true,pages:extracted.pages,total_pages:8,sha256:extracted.sha256,source_sha256:extracted.source_sha256,file_url:'https://caithrin--inksheaf-proof-store-web.modal.run/proof?key=proofs/fixture-1/p-0123456789ab.pdf&exp=4000000000&sig='+'a'.repeat(64),selection_revision:0};
await test('a private draft event follows upload, never marks the complete PDF ready',async()=>{
 const order=[];await publishPreview({book,volume:'1',round:0,upload:async()=>order.push('upload'),key:()=> 'key',url:()=>event.file_url,emit:async e=>{order.push('event');emitted.push(e);}});
 assert.deepEqual(order,['upload','event']);assert.equal(emitted[0].kind,'pages');assert.equal(emitted[0].draft,true);
});
await test('unavailable preview does not stop final checks, but stale event persistence does',async()=>{
 emitted=[];let logs=[];assert.equal(await publishPreview({book,volume:'1',round:0,key:()=> 'key',upload:async()=>{throw Error('private token');},emit:async e=>emitted.push(e),log:s=>logs.push(s)}),false);assert.equal(emitted.length,0);assert(!logs.join('').includes('token'));
 await assert.rejects(()=>publishPreview({book,volume:'1',round:0,key:()=> 'key',url:()=>event.file_url,upload:async()=>{},emit:async()=>{throw Error('selection changed');}}),/selection changed/);
});
const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
db.exec("INSERT INTO signups (id,publication_url,email,raw_json,plan_json) VALUES (1,'https://fixture.substack.com','fixture@example.com','{}','{}')");
const DB={prepare(sql){
 const q=db.prepare(sql);let args=[];
 return {bind(...v){args=v;return this;},async first(){return q.get(...args)||null;},async all(){return {results:q.all(...args)};},async run(){return {meta:{changes:Number(q.run(...args).changes)}};}};
}};
const env={DB,ARCHIVE_RELAY_TOKEN:'fixture'},signature=await hmacHex('fixture','edition:1');
async function save(e=event,sequence=1,run='test.1'){const payload={signup_id:1,run_id:run,sequence,event:e,sig:await hmacHex('fixture',`publisher:1:${run}:${sequence}:${JSON.stringify(e)}`)};return append({env,request:new Request('https://inksheaf.com/api/publisher-event',{method:'POST',body:JSON.stringify(payload)})});}
const req=(query='',method='GET')=>new Request(`https://inksheaf.com/api/edition-pages?id=1&sig=${signature}&run=test.1&sequence=1${query}`,{method});
await save();
const originalFetch=globalThis.fetch;let fetches=0,upstream=()=>new Response(readFileSync(extracted.file),{headers:{'content-type':'application/pdf'}});
globalThis.fetch=async(url,options)=>{fetches++;assert.match(String(url),/^https:\/\/caithrin--inksheaf-proof-store-web.modal.run\/proof\?/);assert.equal(options.redirect,'manual');return upstream();};
try{
 await test('private workspace gives a same-origin preview link without the upstream capability',async()=>{
  const data=await(await edition({env,request:new Request(`https://inksheaf.com/api/edition?id=1&sig=${signature}`)})).json();
  assert.equal(data.events[0].file_url,undefined);assert.match(data.events[0].url,/^\/api\/edition-pages\?/);assert(!JSON.stringify(data).includes('modal.run'));
 });
 await test('wrong edition capability and non-GET never reach the store',async()=>{
  const before=fetches;assert.equal((await pages({env,request:new Request(req().url.replace('id=1','id=2'))})).status,403);assert.equal((await pages({env,request:req('','POST')})).status,405);assert.equal(fetches,before);
 });
 await test('private PDF bytes are verified, uncached, unindexed and never dispatched or emailed',async()=>{
  const before=db.prepare('SELECT total_changes() n').get().n,r=await pages({env,request:req()});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),readFileSync(extracted.file));assert.match(r.headers.get('cache-control'),/no-store/);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
 });
 await test('unexpected origins, paths, redirects, oversize and mismatched bytes are rejected',async()=>{
  for(const file_url of ['https://evil.example/proof','https://caithrin--inksheaf-proof-store-web.modal.run/upload','http://127.0.0.1/proof'])assert.equal((await save({...event,file_url},2)).status,400);
  for(const response of [()=>new Response('redirect',{status:302,headers:{location:'https://evil.example'}}),()=>new Response('%PDF-wrong',{headers:{'content-type':'application/pdf'}}),()=>new Response('big',{headers:{'content-type':'application/pdf','content-length':'10000001'}}),()=>new Response(new Uint8Array(10_000_001),{headers:{'content-type':'application/pdf'}})]){upstream=response;assert.equal((await pages({env,request:req()})).status,502);}
  upstream=()=>new Response(readFileSync(extracted.file),{headers:{'content-type':'application/pdf'}});
 });
 await test('superseded draft and run are unavailable while other volumes remain readable',async()=>{
  await save({...event,volume:'2'},2);assert.equal((await pages({env,request:req()})).status,200);
  await save({...event,round:1},3);assert.equal((await pages({env,request:req()})).status,409);
  await save({kind:'identity'},1,'test.2');assert.equal((await pages({env,request:req()})).status,409);
 });
 await test('replacement pages or a new worker arriving during fetch retire the old response',async()=>{
  for(const newRun of [false,true]){
   db.exec('DELETE FROM publisher_events');await save();
   upstream=async()=>{await save(newRun?{kind:'identity'}:{...event,round:1},newRun?1:2,newRun?'test.2':'test.1');return new Response(readFileSync(extracted.file),{headers:{'content-type':'application/pdf'}});};
   assert.equal((await pages({env,request:req()})).status,409);
  }
  upstream=()=>new Response(readFileSync(extracted.file),{headers:{'content-type':'application/pdf'}});
 });
 await test('an expired snapshot and a saved correction retire the draft',async()=>{
  db.exec('DELETE FROM publisher_events');await save({...event,file_url:event.file_url.replace('4000000000','1')});assert.equal((await pages({env,request:req()})).status,410);
  db.exec('DELETE FROM publisher_events');await save();db.exec("INSERT INTO publisher_selections(signup_id,revision,restored_json) VALUES (1,1,'{}')");const before=fetches;assert.equal((await pages({env,request:req()})).status,409);assert.equal(fetches,before);
 });
 await test('a correction arriving during the PDF fetch prevents returning old bytes',async()=>{
  db.exec('UPDATE publisher_selections SET revision=0');upstream=()=>{db.exec('UPDATE publisher_selections SET revision=1');return new Response(readFileSync(extracted.file),{headers:{'content-type':'application/pdf'}});};assert.equal((await pages({env,request:req()})).status,409);
 });
}finally{globalThis.fetch=originalFetch;db.close();}
console.log(`${n} private publisher preview checks passed`);
