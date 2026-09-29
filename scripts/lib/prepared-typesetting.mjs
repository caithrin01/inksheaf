// One edition's prepared sources survive its layout adjustments. This object is
// private to a volume/selection attempt, never a cross-customer or persistent cache.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {parseDocument} from 'htmlparser2';
import {emitTypst} from './typst-emit.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const adjustments=new Set(['--fit-figs','--fit-text','--back-links','--in-flow','--reading-figures','--picture-figures']);
const inputFiles=new Set(['--fixture','--posts','--brand-file','--design-file','--publisher-result']);
function identity(args){
  const stable=[],files=[];
  for(let i=0;i<args.length;i++){
    if(adjustments.has(args[i])){i++;continue;}
    stable.push(args[i]);
    if(inputFiles.has(args[i]))files.push([resolve(args[i+1]),hash(readFileSync(args[i+1]))]);
  }
  return {args:JSON.stringify(stable),files};
}
function assets(html,baseDir){
  const files=new Map();
  const walk=node=>{
    if(node.type==='tag'&&node.name==='img'&&node.attribs?.src){
      const src=node.attribs.src;
      if(!src.startsWith('data:')){
        if(/^https?:/i.test(src))throw Error('Prepared book contains an unlocalized image');
        const file=resolve(baseDir,src);files.set(file,hash(readFileSync(file)));
      }
    }
    for(const child of node.children||[])walk(child);
  };
  walk(parseDocument(html));return [...files];
}
// Shared by the first build and subsequent emission, including legacy flags
// supplied directly to fit(). Parsing once prevents their treatment from drifting.
export function typstAdjustments(args){
  const argOf=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
  const fitFigs=Object.fromEntries(String(argOf('--fit-figs')||'').split(',').filter(Boolean).map(x=>{const i=x.lastIndexOf('=');return [x.slice(0,i),Number(x.slice(i+1))];}).filter(([k,v])=>k&&v>0));
  const fitText=Object.fromEntries(String(argOf('--fit-text')||'').split(',').filter(Boolean).map(x=>x.split('='))
    .filter(([n,v])=>/^\d+$/.test(n)&&Number(v)>=.54&&Number(v)<=.66).map(([n,v])=>[n,Number(v)]));
  const backLinks=String(argOf('--back-links')||'').split(',').map(Number).filter(n=>Number.isInteger(n)&&n>0);
  const inFlow=String(argOf('--in-flow')||'').split(',').filter(Boolean);
  const readingFigures=Object.fromEntries(String(argOf('--reading-figures')||'').split(',').filter(Boolean).map(x=>{const i=x.lastIndexOf('=');if(i<1||!['column','landscape'].includes(x.slice(i+1)))throw Error('Invalid reading figure mode');return [x.slice(0,i),x.slice(i+1)];}));
  const pictureFigures=String(argOf('--picture-figures')||'').split(',').filter(Boolean);
  return {fitFigs,fitText,backLinks,inFlow,readingFigures,pictureFigures};
}
export class PreparedTypesetting {
  #book;
  capture({args,html}){
    const report=JSON.parse(readFileSync(html.replace(/\.html$/,'.report.json'),'utf8'));
    if(report.engine!=='typst'||!report.preparedTypesetting){this.#book=null;return;}
    const source=readFileSync(html,'utf8');
    this.#book={identity:identity(args),html:source,report,assets:assets(source,dirname(html))};
  }
  render({args,html}){
    const book=this.#book;if(!book)return false;
    const current=identity(args);
    if(current.args!==book.identity.args)return false;
    if(JSON.stringify(current.files)!==JSON.stringify(book.identity.files))throw Error('Prepared edition inputs changed during layout repair');
    for(const [file,digest] of book.assets)if(hash(readFileSync(file))!==digest)throw Error('Prepared source image changed during layout repair');
    const report=structuredClone(book.report),settings=typstAdjustments(args);
    const options={...report.preparedTypesetting,baseDir:dirname(html),sourceFigureRoles:report.sourceFigureRoles||{},...settings};
    const typ=emitTypst(book.html,options);
    for(const name of ['fitFigs','fitText','backLinkArticles','inFlowFigures','readingFigures','pictureFigures'])delete report[name];
    for(const [name,value] of Object.entries({fitFigs:settings.fitFigs,fitText:settings.fitText,backLinkArticles:settings.backLinks,inFlowFigures:settings.inFlow,readingFigures:settings.readingFigures,pictureFigures:settings.pictureFigures}))if(value&&Object.keys(value).length)report[name]=value;
    report.preparedSourceReused=true;
    writeFileSync(html,book.html);writeFileSync(html.replace(/\.html$/,'.typ'),typ);
    writeFileSync(html.replace(/\.html$/,'.report.json'),JSON.stringify(report,null,2));
    return true;
  }
}
