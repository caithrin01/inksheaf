// Deliver complete four-page sheets as Poppler finishes them. A failed or
// partial stream never establishes complete coverage; every child is drained.
import {spawn} from 'node:child_process';
import {mkdirSync,readdirSync,unlinkSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';

export async function streamReviewSheets(pdf,directory,{format='jpeg',onReady=()=>{},onSheet=()=>{},onError=()=>{},spawnImpl=spawn}={}){
  if(!['jpeg','png'].includes(format))throw Error('Invalid review image format');
  const pages=join(directory,'pages'),sheets=join(directory,'sheets');
  for(const [dir,pattern] of [[pages,/^p-\d+\.png$/],[sheets,/^sheet-\d+\.(png|jpg)$/]]){
    mkdirSync(dir,{recursive:true});
    for(const file of readdirSync(dir))if(pattern.test(file))unlinkSync(join(dir,file));
  }
  let header=null,failure=null,stderr='';const seen=new Set();
  const fail=error=>{if(!failure){failure=error;try{onError(error);}catch(callbackError){failure=callbackError;}}};
  const child=spawnImpl('python3',[fileURLToPath(new URL('../raster-pages.py',import.meta.url)),pdf,join(pages,'p'),'--scale','900','--sheet-dir',sheets,'--sheet-format',format],{stdio:['ignore','pipe','pipe']});
  const lines=createInterface({input:child.stdout});
  child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-1000);});
  lines.on('line',line=>{
    if(failure)return;
    try{
      const record=JSON.parse(line);
      if(record.error)throw Error(String(record.error));
      if(!header){
        if(!Number.isSafeInteger(record.pages)||record.pages<1||record.sheets!==Math.ceil(record.pages/4))throw Error('Invalid raster stream header');
        header=record;onReady(record);return;
      }
      if(!Number.isSafeInteger(record.sheet)||record.sheet<1||record.sheet>header.sheets||seen.has(record.sheet))throw Error('Invalid or duplicate raster sheet');
      const first=(record.sheet-1)*4+1,expected=Array.from({length:Math.min(4,header.pages-first+1)},(_,i)=>first+i);
      const file=join(sheets,`sheet-${String(record.sheet).padStart(3,'0')}.${format==='png'?'png':'jpg'}`);
      if(JSON.stringify(record.pages)!==JSON.stringify(expected)||typeof record.file!=='string'||resolve(record.file)!==resolve(file)||!existsSync(file))throw Error('Invalid or duplicate raster sheet');
      seen.add(record.sheet);onSheet({file,pages:record.pages});
    }catch(error){fail(error);}
  });
  // close follows closed stdio, so no final page event can arrive after resolve.
  await new Promise(resolveDone=>{
    child.once('error',error=>fail(error));
    child.once('close',code=>{if(code!==0)fail(Error(`Raster stream failed (${code}): ${stderr.slice(-200)}`));resolveDone();});
  });
  if(!failure&&(!header||seen.size!==header.sheets))fail(Error('Incomplete raster sheet coverage'));
  if(failure)throw failure;
  return {pages:header.pages,sheets:seen.size};
}
