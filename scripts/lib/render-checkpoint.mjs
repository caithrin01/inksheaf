// A completed render is immutable evidence, separate from the review policy.
// The bundle is private: it contains the exact PDF, measurement, report and
// original source figures required to repeat review on a replacement worker.
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {PDFDocument} from 'pdf-lib';
const hash=b=>createHash('sha256').update(b).digest('hex');
const digest=/^[a-f0-9]{64}$/;
export const CHECKPOINT_MAX_BYTES=150_000_000;
const renderer=createHash('sha256');
for(const file of ['fit.mjs','typst-emit.mjs','../build-book.mjs','../render-book.sh','../pdf-whitespace-audit.py','../blank-measure.py'])renderer.update(readFileSync(new URL(file,import.meta.url)));
export const RENDER_CHECKPOINT_POLICY=renderer.digest('hex');
export const renderIdentity=input=>hash(JSON.stringify(input));
const held=()=>Error('The saved render cannot be verified. Its PDF and spent allowances are retained for recovery.');
function atomic(file,bytes){mkdirSync(resolve(file,'..'),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,bytes,{mode:0o600});renameSync(temp,file);}

export async function saveRenderCheckpoint({book,directory,scope,identity,store}){
  const assets={},add=bytes=>{const sha=hash(bytes);assets[sha]=bytes.toString('base64');return sha;};
  const pdfBytes=readFileSync(book.pdf),pdf=add(pdfBytes),measurement=JSON.parse(readFileSync(book.pdf.replace(/\.pdf$/,'.pages.json'),'utf8'));
  for(const figure of measurement.figures||[])if(figure.source){figure.source_asset=add(readFileSync(figure.source));delete figure.source;}
  const report=structuredClone(book.report);
  report.fit=Object.fromEntries(['pass','defer','fitFigs','fitText','backLinks','inFlow','readingFigures','spacing_requires_review'].filter(k=>report.fit[k]!==undefined).map(k=>[k,report.fit[k]]));
  const value={version:1,identity,renderer_policy:RENDER_CHECKPOINT_POLICY,scope,pdf,measurement,report,brand:book.brand??null,assets};
  const raw=Buffer.from(JSON.stringify(value));if(raw.length>CHECKPOINT_MAX_BYTES)throw held();
  const bytes=gzipSync(raw),sha256=hash(bytes),file=join(directory,sha256+'.json.gz');
  atomic(file,bytes);
  // Only a fully acknowledged upload may become the authoritative checkpoint.
  if(store)await store.put(sha256,bytes);
  return {version:1,sha256,identity,renderer_policy:RENDER_CHECKPOINT_POLICY,scope,pdf_sha256:pdf};
}

export async function restoreRenderCheckpoint({reference,directory,scope,identity,store}){
  if(!reference||reference.version!==1||!digest.test(reference.sha256)||reference.identity!==identity
    ||reference.renderer_policy!==RENDER_CHECKPOINT_POLICY||JSON.stringify(reference.scope)!==JSON.stringify(scope))throw held();
  const file=join(directory,reference.sha256+'.json.gz');
  const bytes=existsSync(file)?readFileSync(file):store?await store.get(reference.sha256):null;
  if(!bytes||bytes.length>CHECKPOINT_MAX_BYTES||hash(bytes)!==reference.sha256)throw held();
  let saved;try{saved=JSON.parse(gunzipSync(bytes,{maxOutputLength:CHECKPOINT_MAX_BYTES}));}catch{throw held();}
  if(saved.version!==1||saved.identity!==identity||saved.renderer_policy!==reference.renderer_policy
    ||JSON.stringify(saved.scope)!==JSON.stringify(scope)||saved.pdf!==reference.pdf_sha256||!saved.report?.fit||!saved.report.bodyHashes)throw held();
  const assets=new Map();
  for(const [sha,encoded] of Object.entries(saved.assets||{})){
    if(!digest.test(sha)||typeof encoded!=='string')throw held();
    const b=Buffer.from(encoded,'base64');if(hash(b)!==sha)throw held();assets.set(sha,b);
  }
  const pdfBytes=assets.get(saved.pdf);if(!pdfBytes)throw held();
  const pages=(await PDFDocument.load(pdfBytes)).getPageCount();
  if(saved.measurement?.pages?.length!==pages)throw held();
  const dir=resolve(directory,'restored',reference.sha256);mkdirSync(dir,{recursive:true});
  for(const figure of saved.measurement.figures||[]){
    if(figure.source)throw held(); // Never restore a path supplied by the archive.
    if(figure.source_asset){const b=assets.get(figure.source_asset);if(!b)throw held();figure.source=join(dir,figure.source_asset);atomic(figure.source,b);delete figure.source_asset;}
  }
  const pdf=join(dir,'book.pdf');atomic(pdf,pdfBytes);atomic(pdf.replace(/\.pdf$/,'.pages.json'),JSON.stringify(saved.measurement));
  if(!existsSync(file))atomic(file,bytes);
  return {pdf,report:saved.report,brand:saved.brand,pages,recovered:true};
}
