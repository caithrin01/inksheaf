// Stream a complete private volume with bounded memory. EOF is withheld until
// the immutable digest and current edition are verified. Retain the final bytes
// too: an intermediary may close a failed stream without forwarding its error.
// The browser independently checks the complete digest before PDF decoding.
import {hmacHex} from '../lib/press-dispatch.js';
import {EDITION_MAX_BYTES,privateHeaders,readFinishedEdition} from '../lib/edition-reader.js';
const fail=(error,status)=>Response.json({ok:false,error},{status,headers:privateHeaders});
export async function onRequest({request,env}){
  if(request.method!=='GET')return fail('Method not allowed.',405);
  const u=new URL(request.url),id=Number(u.searchParams.get('id')),run=u.searchParams.get('run'),sequence=Number(u.searchParams.get('sequence')),versionId=Number(u.searchParams.get('version')),volume=Number(u.searchParams.get('volume'));
  if(!Number.isSafeInteger(id)||id<1||!env.ARCHIVE_RELAY_TOKEN||u.searchParams.get('sig')!==await hmacHex(env.ARCHIVE_RELAY_TOKEN,`edition:${id}`))return fail('Open your private edition link.',403);
  if(!/^[a-zA-Z0-9._-]{1,80}$/.test(run||'')||![sequence,versionId,volume].every(x=>Number.isSafeInteger(x)&&x>0)||volume>24)return fail('Volume not found.',404);
  try{
    const current=()=>readFinishedEdition(env.DB,id,run,sequence,versionId);
    const file=(await current())?.[volume-1];
    if(!file)return fail('These pages have been replaced. Refresh your edition.',409);
    if(file.expires_at<=Date.now())return fail('This private PDF link has expired.',410);
    const upstream=await fetch(file.source,{redirect:'manual',signal:AbortSignal.timeout(120000)});
    const size=Number(upstream.headers.get('content-length'));
    if(upstream.status!==200||!upstream.headers.get('content-type')?.startsWith('application/pdf')||!Number.isSafeInteger(size)||size<5||size>EDITION_MAX_BYTES){await upstream.body?.cancel();return fail('Your PDF could not be opened.',502);}
    const input=upstream.body?.getReader();if(!input)return fail('Your PDF could not be opened.',502);
    const digest=new crypto.DigestStream('SHA-256'),writer=digest.getWriter();
    // Abort failures are handled by the stream; never leave a rejected digest unobserved.
    digest.digest.catch(()=>{});
    let length=0,first=new Uint8Array(0),tail=new Uint8Array(0),ended=false;
    const cancel=async reason=>{ended=true;await Promise.allSettled([input.cancel(reason),writer.abort(reason)]);};
    const body=new ReadableStream({
      async pull(controller){
        while(!ended){
        try{
          const {done,value}=await input.read();
          if(done){
            if(length!==size||new TextDecoder().decode(first)!=='%PDF-')throw Error('Incomplete PDF');
            await writer.close();
            const hash=[...new Uint8Array(await digest.digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
            if(hash!==file.sha256)throw Error('PDF digest changed');
            const latest=(await current())?.[volume-1];
            if(!latest||latest.sha256!==file.sha256||latest.source!==file.source||latest.expires_at<=Date.now())throw Error('Edition changed');
            ended=true;controller.enqueue(tail);controller.close();input.releaseLock();return;
          }
          length+=value.byteLength;if(length>size||length>EDITION_MAX_BYTES)throw Error('PDF exceeds its limit');
          if(first.length<5){const prefix=new Uint8Array(Math.min(5,first.length+value.length));prefix.set(first);prefix.set(value.subarray(0,5-first.length),first.length);first=prefix;}
          await writer.write(value);
          if(value.length>=64){if(tail.length)controller.enqueue(tail);if(value.length>64)controller.enqueue(value.subarray(0,value.length-64));tail=value.slice(-64);}
          else{const joined=new Uint8Array(tail.length+value.length);joined.set(tail);joined.set(value,tail.length);if(joined.length>64)controller.enqueue(joined.slice(0,joined.length-64));tail=joined.slice(-64);}
          if(length>64)return;
        }catch(error){await cancel(error);controller.error(Error('Your PDF could not be verified. Refresh your edition and try again.'));return;}
        }
      },cancel,
    });
    return new Response(body,{headers:{...privateHeaders,'content-type':'application/pdf','content-length':String(size),'content-disposition':`${u.searchParams.get('download')==='1'?'attachment':'inline'}; filename="volume-${volume}.pdf"`,'x-content-sha256':file.sha256}});
  }catch{return fail('Your PDF could not be opened. Try again shortly.',503);}
}
