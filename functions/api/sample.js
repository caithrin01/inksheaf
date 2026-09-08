// A bounded public-text sample from an already confirmed publication. No paywall access.
import { parseHost } from './preview.js';
import { PREVIEW_SCHEMA_VERSION } from '../lib/publication-identity.js';
import { publicExcerpt } from '../lib/public-excerpt.js';
import { spend, ipKey } from '../lib/quota.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const unavailable=()=>json({ok:false,message:'We could not load a public text sample. Your complete proof comes after you reserve and confirm ownership.'},422);
const RELAY='https://caithrin--inksheaf-archive-relay-sample.modal.run';
async function readPost(host,candidate,env,relayed,timeoutMs){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const opts={redirect:'manual',signal:controller.signal,headers:{accept:'application/json','user-agent':'Mozilla/5.0 Inksheaf-public-sample/1.0'}};
    let target=`https://${host}/api/v1/posts/${candidate.slug}`,r;
    if(relayed){
      const enc=new TextEncoder(),bucket=Math.floor(Date.now()/300000);
      const key=await crypto.subtle.importKey('raw',enc.encode(env.ARCHIVE_RELAY_TOKEN),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(`${host}:sample:${candidate.slug}:${candidate.id}:${bucket}`)));
      const sig=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
      target=RELAY+'?'+new URLSearchParams({host,slug:candidate.slug,post_id:String(candidate.id),sig});
    }
    for(let hop=0;hop<(relayed?1:3);hop++){
      r=await fetch(target,opts);
      if(r.status<300||r.status>=400)break;
      const next=new URL(r.headers.get('location')||'',target);
      if(relayed || next.protocol!=='https:'||next.username||next.password||next.port||next.hostname.replace(/^www\./,'')!==host.replace(/^www\./,'')||next.pathname!==`/api/v1/posts/${candidate.slug}`||next.search||next.hash)break;
      target=next.href;
    }
    if(!r.ok || Number(r.headers.get('content-length')||0)>2_000_000)return null;
    const reader=r.body.getReader();let bytes=0;const chunks=[];
    for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2_000_000){await reader.cancel();return null;}chunks.push(value);}
    const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
    return JSON.parse(new TextDecoder().decode(all));
  }catch{return null;}finally{clearTimeout(timeout);}
}
export async function onRequest({request,env}) {
  if(request.method!=='GET')return json({ok:false,message:'Method not allowed.'},405);
  const host=parseHost(new URL(request.url).searchParams.get('url')||'');
  if(!host)return unavailable();
  const quota=await spend(env,`sample:${await ipKey(request)}`,60);
  if(!quota.ok)return json({ok:false,message:'Sample previews are busy. Please try again later.'},429);
  const cached=await env.DB.prepare('SELECT payload, fetched_at FROM preview_cache WHERE host = ?').bind(host).first().catch(()=>null);
  let preview;
  try { preview=JSON.parse(cached?.payload); } catch { return unavailable(); }
  if(preview.summary_version!==PREVIEW_SCHEMA_VERSION || preview.host!==host || Date.now()-Date.parse(cached.fetched_at)>86400e3)return unavailable();
  const candidates=(preview.sample||[]).filter(p=>/^[a-z0-9][a-z0-9-]{0,199}$/i.test(p.slug||'') && Number.isSafeInteger(Number(p.id)) && Number(p.id)>0).slice(0,2);
  const cacheKey=new Request(`https://sample-cache.inksheaf.invalid/v1/${host}/${candidates[0]?.slug||''}`);
  const cache=globalThis.caches?.default;
  if(cache){const hit=await cache.match(cacheKey);if(hit)return hit;}
  // Reuse the confirmed archive's working network path. The relay is authenticated,
  // fixed-purpose and bound to this cached host, slug and post ID. Stay inside the
  // reader's 14-second timeout even if the first public post is no longer available.
  const deadline=Date.now()+12000;
  const paths=env.ARCHIVE_RELAY_TOKEN?(preview.fetch_mode==='relay'?[true]:[false,true]):[false];
  for(const candidate of candidates) for(const relayed of paths) {
      const remaining=deadline-Date.now();if(remaining<100)return unavailable();
      const post=await readPost(host,candidate,env,relayed,Math.min(remaining,relayed?5500:3000));
      if(!post)continue;
      if(String(post.id)!==String(candidate.id) || post.slug!==candidate.slug)continue;
      const excerpt=publicExcerpt(post);if(!excerpt)continue;
      const result={ok:true,publication:preview.publication,host,post_id:post.id,title:String(post.title||candidate.t).slice(0,200),subtitle:String(post.subtitle||'').slice(0,350),date:String(post.post_date||'').slice(0,10),source:`https://${host}/p/${candidate.slug}`, ...excerpt};
      const response=json(result);
      if(cache){const stored=new Response(JSON.stringify(result),{headers:{'content-type':'application/json','cache-control':'public, max-age=3600'}});await cache.put(cacheKey,stored).catch(()=>{});}
      return response;
  }
  return unavailable();
}
