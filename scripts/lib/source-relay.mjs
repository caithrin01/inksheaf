// Press fallback for Substack reads that a datacenter egress is refused (HTTP
// 403). The signed Modal relay reads the same public archive page or public
// post; nothing is sent upstream but the host, offset or post identity.
import {createHmac} from 'node:crypto';
export const RELAY_ARCHIVE='https://caithrin--inksheaf-archive-relay-archive.modal.run';
export const RELAY_SAMPLE='https://caithrin--inksheaf-archive-relay-sample.modal.run';
export const refused=error=>/^Source HTTP 403\b/.test(String(error?.message||''));
export function sourceRelay({token=process.env.ARCHIVE_RELAY_TOKEN||'',fetchImpl=fetch,now=Date.now,timeoutMs=60000}={}){
  if(!token)return null;
  const sign=message=>createHmac('sha256',token).update(message).digest('hex');
  const read=async url=>{
    const r=await fetchImpl(url,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
    if(!r.ok)throw Error(`Relay HTTP ${r.status}`);
    return r.json();
  };
  return {
    archive(host,offset){
      if(!Number.isInteger(offset)||offset<0||offset>1800)throw Error('Relay archive offset out of range');
      return read(`${RELAY_ARCHIVE}?${new URLSearchParams({host,offset:String(offset),sig:sign(`${host}:${offset}`)})}`);
    },
    // A publication on its own domain serves posts there; the relay follows no
    // cross-host redirect, so ask the canonical host named by the archive row.
    async post(row,fallbackHost){
      let host=fallbackHost;
      try{const u=new URL(row.canonical_url);if(u.protocol==='https:'&&u.pathname.startsWith('/p/'))host=u.hostname;}catch{}
      const bucket=Math.floor(now()/300000);
      const post=await read(`${RELAY_SAMPLE}?${new URLSearchParams({host,slug:row.slug,post_id:String(row.id),sig:sign(`${host}:sample:${row.slug}:${row.id}:${bucket}`)})}`);
      if(String(post.id)!==String(row.id)||post.slug!==row.slug||typeof post.body_html!=='string')throw Error('Relay returned a different post');
      return {...row,...post};
    },
  };
}
