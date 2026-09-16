// Freeze the agreed random sample through the real read-only preview/identity
// path. Every recommended volume is retained. No signup, paid model, dispatch,
// email, upload, listing or order capability is configured.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {fetchArchive} from '../../functions/api/preview.js';
import {onRequest as publicationRead} from '../../functions/api/publication.js';
import {reviewMemoryDb} from '../lib/review-memory-db.mjs';
import {publicationFromArchive} from '../../functions/lib/publication-identity.js';
import {mapConcurrent} from '../lib/async-work.mjs';
import {sourceJsonClient} from '../lib/source-request.mjs';
const arg=n=>{const i=process.argv.indexOf(n);return i<0?null:process.argv[i+1];};
const selection=arg('--selection'),output=arg('--out');
if(!selection||!output)throw Error('Use --selection frozen-selection.json --out a-new-private-directory');
const root=resolve(output);if(existsSync(root))throw Error('Use a fresh directory; preserve previous corpus evidence');
const bytes=readFileSync(selection),picked=JSON.parse(bytes);
if(picked.seed!=='1ee14dd5a1910fe4e5ba946e7bfe2822'||picked.selected?.length!==12)throw Error('The agreed fixed sample is required');
const token=process.env.ARCHIVE_RELAY_TOKEN||readFileSync(join(homedir(),'.secrets/inksheaf-relay-token'),'utf8').trim();
const env={DB:reviewMemoryDb(),ARCHIVE_RELAY_TOKEN:token};
mkdirSync(root,{recursive:true});writeFileSync(join(root,'selection.json'),bytes,{mode:0o600});
const readSource=sourceJsonClient({headers:{'user-agent':'Mozilla/5.0 inksheaf-private-review/1.0',accept:'application/json'}});
let sourceBackoff=null;
const result={started:new Date().toISOString(),selection_sha256:createHash('sha256').update(bytes).digest('hex'),scope:'Fresh read-only public source capture; every volume of the recommended route. This is not PDF or delivery acceptance.',publications:[]};
const save=()=>writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2),{mode:0o600});save();
for(const row of picked.selected){
 const started=Date.now(),dir=join(root,row.host);mkdirSync(dir);
 const record={host:row.host,category:row.category,status:sourceBackoff?'not attempted after shared server backoff':'reading'};result.publications.push(record);save();
 if(sourceBackoff){record.backoff=sourceBackoff;save();continue;}
 const put=(name,value)=>writeFileSync(join(dir,name),JSON.stringify(value,null,2),{mode:0o600});
 try{
  const [archive,identityResponse]=await Promise.all([fetchArchive(row.host,env),publicationRead({request:new Request('https://inksheaf.com/api/publication?url='+encodeURIComponent(row.host)),env})]);
  const identity=await identityResponse.json();put('archive.json',archive);put('identity.json',identity);
  if(!archive.ok){record.status=archive.error==='empty'?'ineligible':'source unavailable';record.error=archive.error;record.message=archive.message;continue;}
  const route=archive.data.editorial?.plan?.routes?.find(r=>r.recommended)||archive.data.editorial?.plan?.routes?.[0];
  if(!route?.volumes?.length){record.status='ineligible';record.error='no binding route';continue;}
  const wanted=new Set(route.volumes.flatMap(v=>v.post_ids.map(String)));
  const posts=archive.posts.filter(p=>wanted.has(String(p.id??p.slug)));
  if(posts.length!==wanted.size)throw Error('Recommended route names missing or duplicate source posts');
  const pub=publicationFromArchive(archive.posts,archive.data.host);
  record.route=route.cadence;record.volumes=route.volumes.length;record.selected_posts=posts.length;put('volumes.json',route.volumes);
  const outcomes=await mapConcurrent(posts,async post=>{
   try{
    if(post.audience&&post.audience!=='everyone')throw Error('Selected source is not public');
    const data=await readSource(`https://${archive.data.host}/api/v1/posts/${encodeURIComponent(post.slug)}`);if(data.audience&&data.audience!=='everyone'||!data.body_html||data.body_html.length>2_000_000)throw Error('No complete public body');
    if(String(data.id??data.slug)!==String(post.id??post.slug))throw Error('Returned source identity differs');
    return {post:{...post,...data,publication:pub}};
   }catch(e){if(e.code==='SOURCE_RETRY_LATER')sourceBackoff||={host:row.host,retry_after_ms:e.retry_after_ms};return {error:{id:post.id,slug:post.slug,error:String(e.message).slice(0,200),...(e.code?{code:e.code}:{})}};}
  },{concurrency:4});
  const full=outcomes.filter(x=>x.post).map(x=>x.post),errors=outcomes.filter(x=>x.error).map(x=>x.error);
  put('posts.json',full);put('errors.json',errors);
  put('brand.json',{host:archive.data.host,logo_url:identity.logo_url,cover_usable:true,cover_bg:identity.theme?.cover_bg||'#eee9de',cover_print:identity.theme?.cover_ink||'#25231f',accent:'#26251f',heading_font:'Source Serif 4',body_font:'Source Serif 4',heading_weight:560});
  put('expectations.json',{source_ids:full.map(p=>String(p.id??p.slug)),body_hashes:Object.fromEntries(full.map(p=>[String(p.id??p.slug),createHash('sha256').update(p.body_html).digest('hex')])),volumes:route.volumes.map(v=>({label:v.label,post_ids:v.post_ids.map(String)}))});
  record.fetched_bodies=full.length;record.failures=errors.length;record.status=sourceBackoff?'stopped after shared server backoff':errors.length?'incomplete source capture':'sources complete';
 }catch(e){record.status='source unavailable';record.error=String(e.message).slice(0,200);}
 finally{record.elapsed_ms=Date.now()-started;save();console.log(JSON.stringify(record));}
}
result.status=sourceBackoff?'stopped after shared server backoff':'capture finished';result.finished=new Date().toISOString();save();
