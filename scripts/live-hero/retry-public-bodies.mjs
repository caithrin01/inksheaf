import{readFileSync,writeFileSync,existsSync}from'node:fs';
import{publicationFromArchive}from'../../functions/lib/publication-identity.js';
const root='output/private-acceptance';const results=JSON.parse(readFileSync(`${root}/fetch-results.json`));
for(const row of results){if(!row.bodyErrors?.length)continue;const dir=`${root}/${row.host}`,archive=JSON.parse(readFileSync(`${dir}/archive.json`)),posts=JSON.parse(readFileSync(`${dir}/posts.json`));const fixes=[],remaining=[];
 for(const error of row.bodyErrors){
  const original=archive.posts.find(p=>p.slug===error.slug);let body=null;
  // Public article HTML is a different read path from the public JSON endpoint.
  // Do not read subscriber-only bodies, authenticated cookies, feeds or relay mutations.
  for(const path of [`/p/${encodeURIComponent(error.slug)}`,`/api/v1/posts/${encodeURIComponent(error.slug)}`]){
   try{const r=await fetch(`https://${archive.data.host}${path}`,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'user-agent':'Mozilla/5.0 inksheaf-private-review/1.0'}});if(!r.ok)continue;const text=await r.text();let p;if(path.startsWith('/p/')){const m=text.match(/window\._preloads\s*=\s*JSON\.parse\("((?:[^"\\]|\\.)*)"\)/);p=m?JSON.parse(JSON.parse('"'+m[1]+'"')).post:null;}else p=JSON.parse(text);
   if(p?.body_html&&(!p.audience||p.audience==='everyone')&&p.slug===original.slug&&String(p.id)===String(original.id)){body={...original,...p,publication:publicationFromArchive(archive.posts,archive.data.host)};fixes.push({slug:error.slug,via:path.startsWith('/p/')?'public_article_html':'public_json_after_cooldown'});break;}}
   catch{}
   await new Promise(r=>setTimeout(r,750));
  }
  if(body)posts.push(body);else remaining.push(error);await new Promise(r=>setTimeout(r,500));
 }
 writeFileSync(`${dir}/posts.json`,JSON.stringify(posts));writeFileSync(`${dir}/body-retries.json`,JSON.stringify({fixes,remaining},null,2));row.fetchedBodies=posts.length;row.bodyErrors=remaining;row.recoveredBodies=fixes.length;writeFileSync(`${dir}/fetch.json`,JSON.stringify(row,null,2));writeFileSync(`${root}/fetch-results.json`,JSON.stringify(results,null,2));console.log(row.host,fixes.length,'recovered,',remaining.length,'remaining');
}
