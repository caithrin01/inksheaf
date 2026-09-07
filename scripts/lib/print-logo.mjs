// Embed the publication's logo once, so a print render cannot paint a broken remote image.
import {publicationLogo} from '../../functions/lib/publication-identity.js';
export async function printLogo(url,host){
 const safe=publicationLogo({logo_url:url},host);if(!safe)return '';
 try{
  const r=await fetch(safe,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{accept:'image/png,image/jpeg,image/webp'}});
  const mime=(r.headers.get('content-type')||'').split(';')[0];
  if(!r.ok||!/^image\/(png|jpeg|webp)$/.test(mime)||Number(r.headers.get('content-length')||0)>2_000_000)throw Error('Unsupported logo response');
  const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>2_000_000)throw Error('Logo too large');
  return `data:${mime};base64,${bytes.toString('base64')}`;
 }catch(e){throw new Error(`Publication logo could not be embedded: ${e.message}`);}
}
