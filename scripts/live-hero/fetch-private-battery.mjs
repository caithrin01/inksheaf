// Private, read-only content collection. No signup, worker, listing, upload or email calls.
import{readFileSync,writeFileSync,mkdirSync,existsSync}from'node:fs';
import{fetchArchive}from'../../functions/api/preview.js';
import{onRequest as identityRead}from'../../functions/api/publication.js';
import{reviewMemoryDb}from'../lib/review-memory-db.mjs';
import{publicationFromArchive}from'../../functions/lib/publication-identity.js';
const root='output/private-acceptance';
const {selected}=JSON.parse(readFileSync(`${root}/selection.json`));
const token=process.env.ARCHIVE_RELAY_TOKEN||readFileSync(process.env.HOME+'/.secrets/inksheaf-relay-token','utf8').trim();
// Keep archive assessment deterministic; model planning is a separate recorded checkpoint.
delete process.env.ANTHROPIC_API_KEY;delete process.env.OPENROUTER_API_KEY;
const env={DB:reviewMemoryDb(),ARCHIVE_RELAY_TOKEN:token};
const results=[];
for(const row of [...selected,{category:'owner',host:'caithrin.com',name:'caithrin'}]){
 const dir=`${root}/${row.host}`;mkdirSync(dir,{recursive:true});
 if(existsSync(`${dir}/fetch.json`)){results.push(JSON.parse(readFileSync(`${dir}/fetch.json`)));console.log('REUSE',row.host);continue;}
 const start=Date.now();const result={host:row.host,category:row.category};
 try{
  const archive=await fetchArchive(row.host,env);writeFileSync(`${dir}/archive.json`,JSON.stringify(archive,null,2));
  const ir=await identityRead({request:new Request('https://inksheaf.com/api/publication?url='+encodeURIComponent(row.host)),env});const identity=await ir.json();writeFileSync(`${dir}/identity.json`,JSON.stringify(identity,null,2));
  result.identity=identity.ok?identity.publication:null;result.preview=archive.ok;result.error=archive.error||null;
  if(!archive.ok){result.message=archive.message;throw Error(archive.error||'archive unavailable');}
  const d=archive.data;result.publicPosts=d.public_posts;result.paidPosts=d.paid_posts;result.capped=d.capped;result.postsRead=archive.posts.length;
  const route=d.editorial?.plan?.routes?.find(r=>r.recommended)||d.editorial?.plan?.routes?.[0];
  const volume=route?.volumes?.[0];result.route=route?.cadence;result.volume=volume?.label;result.totalVolumes=route?.volumes?.length||0;
  if(!volume){result.renderStatus='No binding route; retain as a negative-path test.';throw Error('no binding route');}
  const wanted=new Set(volume.post_ids.map(String));writeFileSync(`${dir}/selected-posts.json`,JSON.stringify([...wanted]));
  const posts=archive.posts.filter(p=>wanted.has(String(p.id??p.slug)));
  const pub=publicationFromArchive(archive.posts,archive.data.host)||{id:row.id,name:identity.publication,subdomain:row.subdomain,custom_domain:row.host,logo_url:identity.logo_url};
  const full=[],errors=[];
  for(const post of posts){
   if(post.audience && post.audience!=='everyone'){errors.push({slug:post.slug,error:'Not public; not fetched'});continue;}
   let fetched=null;
   for(let attempt=0;attempt<3;attempt++){
    try{const r=await fetch(`https://${d.host}/api/v1/posts/${encodeURIComponent(post.slug)}`,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'user-agent':'Mozilla/5.0 inksheaf-private-review/1.0',accept:'application/json'}});if(r.ok){const p=await r.json();if((!p.audience||p.audience==='everyone')&&p.body_html){fetched={...post,...p,publication:pub};break;}errors.push({slug:post.slug,status:r.status,error:'No public complete body'});break;}if(r.status<429){errors.push({slug:post.slug,status:r.status});break;}}catch(e){if(attempt===2)errors.push({slug:post.slug,error:e.message});}
    await new Promise(r=>setTimeout(r,500*(attempt+1)));
   }
   if(fetched)full.push(fetched);else if(!errors.some(e=>e.slug===post.slug))errors.push({slug:post.slug,error:'Public origin unavailable after three attempts'});
  }
  writeFileSync(`${dir}/posts.json`,JSON.stringify(full));writeFileSync(`${dir}/body-errors.json`,JSON.stringify(errors,null,2));
  writeFileSync(`${dir}/brand.json`,JSON.stringify({host:d.host,logo_url:identity.logo_url,cover_usable:true,cover_bg:identity.theme?.cover_bg||'#eee9de',cover_print:identity.theme?.cover_ink||'#25231e',accent:'#26251f',heading_font:'Source Serif 4',body_font:'Source Serif 4',heading_weight:560}));
  result.selectedPosts=posts.length;result.fetchedBodies=full.length;result.bodyErrors=errors;result.expectedPages=volume.est_pages||volume.pages;
  if(identity.logo_url){try{const r=await fetch(identity.logo_url,{signal:AbortSignal.timeout(10000)});if(r.ok){writeFileSync(`${dir}/logo.img`,Buffer.from(await r.arrayBuffer()));result.logoDownloaded=true;}}catch{result.logoDownloaded=false;}}
 }catch(e){result.failure=e.message;}
 result.ms=Date.now()-start;writeFileSync(`${dir}/fetch.json`,JSON.stringify(result,null,2));results.push(result);writeFileSync(`${root}/fetch-results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(result));
}
