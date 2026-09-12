// Private evidence for a measured layout decision. Paths stay local; only labelled
// page images, their hashes and the corresponding measurements enter inference.
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {contactSheets,pageOf} from './page-review.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function prepareLayoutEvidence(input,{directory,rasterDirectory,pageCount,policy}){
  const files=new Map(readdirSync(rasterDirectory).filter(f=>/^p-\d+\.png$/.test(f)).map(f=>[pageOf(f),join(rasterDirectory,f)]));
  const imagesByPage=new Map(),imageHashes=[];
  const packet={...input,pages:input.pages.map(page=>{
    const pages=[page.page-1,page.page,page.page+1].filter(p=>p>=1&&p<=pageCount);
    if(!pages.includes(page.page)||pages.some(p=>!files.has(p)))throw Error('Layout review is missing a required page image');
    const [sheet]=contactSheets(pages.map(p=>files.get(p)),join(directory,'layout-images',input.pdf_hash,String(page.page)),{format:'png'});
    imagesByPage.set(page.page,sheet.file);imageHashes.push({page:page.page,sha256:sha(readFileSync(sheet.file))});
    return {...page,visual_context:{physical_pages:pages,target_page:page.page,tile_order:'top-left, top-right, bottom-left; unused tiles are gray'}};
  })};
  const request={policy,input:packet,image_hashes:imageHashes};
  const requestHash=sha(JSON.stringify(request));
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,`layout-input-${requestHash}.json`),JSON.stringify(request,null,2)+'\n',{mode:0o600});
  const saveResult=result=>{
    const evidence={request_sha256:requestHash,pdf_sha256:input.pdf_hash,...result};
    const content=JSON.stringify(evidence,null,2)+'\n';
    writeFileSync(join(directory,`layout-result-${sha(content)}.json`),content,{mode:0o600});
  };
  return {input:packet,imagesByPage,saveResult};
}
