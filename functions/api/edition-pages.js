// Same-origin, read-only access to the latest draft for this private edition.
// Never accepts an arbitrary upstream URL or exposes its proof-store capability.
import {hmacHex} from '../lib/press-dispatch.js';
import {readPublisherSelection} from '../lib/publisher-selection.js';
import {PREVIEW_MAX_BYTES,previewURL,validPreview} from '../lib/publisher-preview.js';
const headers={'cache-control':'private, no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff'};
const fail=(error,status)=>Response.json({ok:false,error},{status,headers});
export async function onRequest({request,env}){
  if(request.method!=='GET')return fail('Method not allowed.',405);
  const u=new URL(request.url),id=Number(u.searchParams.get('id')),run=u.searchParams.get('run'),sequence=Number(u.searchParams.get('sequence'));
  if(!Number.isSafeInteger(id)||id<1||!env.ARCHIVE_RELAY_TOKEN||u.searchParams.get('sig')!==await hmacHex(env.ARCHIVE_RELAY_TOKEN,`edition:${id}`))return fail('Open your private edition link.',403);
  if(!/^[a-zA-Z0-9._-]{1,80}$/.test(run||'')||!Number.isSafeInteger(sequence)||sequence<1)return fail('Page preview not found.',404);
  try{
    const current=await env.DB.prepare('SELECT run_id FROM publisher_events WHERE signup_id=? ORDER BY id DESC LIMIT 1').bind(id).first();
    if(current?.run_id!==run)return fail('These pages have been replaced. Refresh your edition.',409);
    const row=await env.DB.prepare("SELECT payload FROM publisher_events WHERE signup_id=? AND run_id=? AND sequence=? AND kind='pages'").bind(id,run,sequence).first();
    if(!row)return fail('Page preview not found.',404);
    const event=JSON.parse(row.payload),selection=await readPublisherSelection(env.DB,id);
    if((event.selection_revision??0)!==selection.revision)return fail('Your revised pages are being prepared.',409);
    if(!validPreview(event))return fail('Page preview unavailable.',503);
    const latest=await env.DB.prepare("SELECT sequence FROM publisher_events WHERE signup_id=? AND run_id=? AND kind='pages' AND json_extract(payload,'$.volume')=? ORDER BY sequence DESC LIMIT 1").bind(id,run,event.volume).first();
    if(latest?.sequence!==sequence)return fail('These pages have been replaced. Refresh your edition.',409);
    const source=previewURL(event.file_url);
    if(Number(source.searchParams.get('exp'))<=Math.floor(Date.now()/1000))return fail('This draft preview has expired.',410);
    const upstream=await fetch(source.href,{redirect:'manual',signal:AbortSignal.timeout(20000)});
    if(upstream.status!==200||!upstream.headers.get('content-type')?.startsWith('application/pdf')||Number(upstream.headers.get('content-length'))>PREVIEW_MAX_BYTES){await upstream.body?.cancel();return fail('The pages could not be opened. Try again shortly.',502);}
    const reader=upstream.body?.getReader();if(!reader)return fail('Page preview unavailable.',502);
    let length=0;const chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>PREVIEW_MAX_BYTES){await reader.cancel();return fail('Page preview unavailable.',502);}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-'||digest!==event.sha256)return fail('Page preview unavailable.',502);
    // A restore during the fetch must retire these bytes too.
    if((await readPublisherSelection(env.DB,id)).revision!==selection.revision)return fail('Your revised pages are being prepared.',409);
    const finalRun=await env.DB.prepare('SELECT run_id FROM publisher_events WHERE signup_id=? ORDER BY id DESC LIMIT 1').bind(id).first();
    const finalPages=await env.DB.prepare("SELECT sequence FROM publisher_events WHERE signup_id=? AND run_id=? AND kind='pages' AND json_extract(payload,'$.volume')=? ORDER BY sequence DESC LIMIT 1").bind(id,run,event.volume).first();
    if(finalRun?.run_id!==run||finalPages?.sequence!==sequence)return fail('These pages have been replaced. Refresh your edition.',409);
    return new Response(bytes,{headers:{...headers,'content-type':'application/pdf','content-disposition':'inline; filename="pages-in-progress.pdf"','content-length':String(length)}});
  }catch{return fail('The pages could not be opened. Try again shortly.',503);}
}
