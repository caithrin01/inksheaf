#!/usr/bin/env node
// Local review of the built candidate. Fixed public fixtures; no external API calls.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { onRequest as publicPreview } from '../functions/api/preview.js';
import { onRequest as publicSample } from '../functions/api/sample.js';
import { reviewMemoryDb } from './lib/review-memory-db.mjs';
import { calendar, editorial } from './fixtures/preview-editor-exclusion.mjs';
const sample=JSON.parse(await readFile('scripts/fixtures/public-sample-caithrin.json','utf8'));
const identity=JSON.parse(await readFile('scripts/fixtures/publication-caithrin.json','utf8'));
const liveReads=process.env.INKSHEAF_REVIEW_PUBLIC_READS==='1', DB=reviewMemoryDb();
const root=resolve('dist'), port=Number(process.env.INKSHEAF_REVIEW_PORT||8807);
await stat(resolve(root,'index.html'));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.avif':'image/avif','.webp':'image/webp','.woff2':'font/woff2','.ttf':'font/ttf'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const v3Alternative=url.pathname==='/v3-b/';
  if(v3Alternative)url.pathname='/';
  // Review-only studies never enter Astro's public build or the release artifact.
  const studyFiles={
    '/design-study/':'scripts/design-review/study.html',
    '/design-study/content.json':'scripts/design-review/study-content.json',
    '/design-study/desk.png':'assets/motion/topdown-study-2026-09-07/desk-only.png',
  };
  if(url.pathname==='/design-study/paper.svg'){
    res.writeHead(200,{'content-type':'image/svg+xml'});
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".065"/></feComponentTransfer></filter><rect width="100%" height="100%" filter="url(#n)" opacity=".6"/></svg>');
  }
  if(studyFiles[url.pathname]){
    try{const file=studyFiles[url.pathname];const content=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/json','cache-control':'no-store'});return res.end(content);}
    catch{res.writeHead(404);return res.end('Study asset unavailable. See scripts/design-review/README.md.');}
  }
  const json=body=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
  if(url.pathname.startsWith('/api/')){
    req.resume();
    if(liveReads && ['/api/preview','/api/sample'].includes(url.pathname)){
      try{const handler=url.pathname==='/api/preview'?publicPreview:publicSample;const response=await handler({request:new Request(url.href,{method:req.method}),env:{DB}});res.writeHead(response.status,{'content-type':'application/json','cache-control':'no-store'});return res.end(await response.text());}
      catch(error){res.writeHead(502,{'content-type':'application/json'});return res.end(JSON.stringify({ok:false,message:'The public archive did not answer. Please try again.'}));}
    }
    if(url.pathname==='/api/preview'){
      const input=url.searchParams.get('url')||'';
      return json(/^(https?:\/\/)?caithrin\.com\/?$/i.test(input)?{...calendar,logo_url:identity.logo_url,theme:identity.theme}:
        {ok:false,message:'This local review uses the caithrin.com fixture. Enter caithrin.com to try it.'});
    }
    if(url.pathname==='/api/sample')return json(sample);
    if(url.pathname==='/api/plan'){
      if(liveReads)return json({ok:false,message:'No external editor is connected to local review.'});
      await new Promise(resolve=>setTimeout(resolve,3000));return json({ok:true,editorial});
    }
    if(url.pathname==='/api/signup')return json({ok:true,press:'test'});
    if(url.pathname==='/api/feedback')return json({ok:false,error:'Local review: feedback is not saved. Send notes in the conversation.'});
    if(url.pathname==='/api/event')return json({ok:true});
    return json({ok:false,message:'This action is not part of the local review.'});
  }
  try{
    let path=resolve(root,'.'+decodeURIComponent(url.pathname));
    if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);return res.end();}
    if((await stat(path)).isDirectory())path=resolve(path,'index.html');
    let content=await readFile(path);
    if(v3Alternative)content=Buffer.from(content.toString().replace('</head>','<style>'+await readFile('scripts/design-review/v3-alternative.css','utf8')+'</style></head>'));
    if(path===resolve(root,'index.html'))content=Buffer.from(content.toString().replace('</body>',
      '<aside style="position:relative;z-index:1000;background:#211c15;color:#fff5df;font:11px/1.4 system-ui,sans-serif;text-align:center;padding:6px 12px">'+(liveReads?'Local review · Real public archives · Reservations are simulated. No email or printing.':'Local review · caithrin.com sample archive · No email, reservations, or printing are sent.')+'</aside></body>'));
    res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream','cache-control':'no-store'});res.end(content);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local review: http://127.0.0.1:${port}/ — ${liveReads?'real public GETs; all reservations simulated':'use caithrin.com; all API effects simulated'}.`));
