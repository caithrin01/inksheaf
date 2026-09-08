// Embed the publication's logo once, so a print render cannot paint a broken remote image.
import {publicationLogo} from '../../functions/lib/publication-identity.js';
import {coverLogo} from '../../functions/lib/cover-logo.js';
import {readFileSync} from 'node:fs';
export async function printCoverLogo(design,brand,host){
 if(design.version===1)return {logo:await printLogo(brand?.logo_url,host),version:1};
 const result=coverLogo({host,logo_url:brand?.logo_url,theme:design.palette||{cover_bg:brand?.cover_bg},logo_treatment:design.logo},design.cover);
 if(/^\/book\/caithrin-mark-(charcoal|gold)\.svg$/.test(result.logo))result.logo='data:image/svg+xml;base64,'+readFileSync('public'+result.logo).toString('base64');
 else result.logo=await printLogo(result.logo,host);
 return result;
}
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
