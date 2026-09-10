#!/usr/bin/env node
// Serve only the built static artifact and run local, simulated browser acceptance.
// This command needs no Cloudflare, email, model, or production credentials.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
const root=resolve('dist');
await stat(resolve(root,'index.html'));
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.avif':'image/avif','.webp':'image/webp','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try{
    let path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);return res.end();}
    if((await stat(path)).isDirectory())path=resolve(path,'index.html');
    const content=await readFile(path);res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream'});res.end(content);
  }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`;
async function run(script,args){
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,...args],{stdio:'inherit'});
    child.once('error',reject);child.once('exit',resolve);
  });
  if(code!==0)throw new Error(`${script} exited ${code}`);
}
try{
  if(process.argv.includes('--pages-only')){
    await run('scripts/test-publisher-pages-ui.mjs',[base]);
  }else if(process.argv.includes('--publisher-only')){
    await run('scripts/test-verification-ui.mjs',[base]);
  }else{
    await run('scripts/test-overhead-journey.mjs',[base,'output/playwright/launch/overhead']);
    await run('scripts/test-edition-journey.mjs',[base,'output/playwright/launch/edition']);
    await run('scripts/test-publication-cover.mjs',[base,'output/playwright/launch/publication-cover']);
    await run('scripts/test-launch-states.mjs',[base,'output/playwright/launch/states']);
    await run('scripts/test-site-design.mjs',[base]);
    await run('scripts/test-site-workflows.mjs',[base]);
    await run('scripts/test-verification-ui.mjs',[base]);
    await run('scripts/test-publisher-pages-ui.mjs',[base]);
    await run('scripts/test-live-publication.mjs',[base,'output/playwright/launch/live-publication']);

  }
}catch(error){console.error(error.message);process.exitCode=1;}
finally{server.close();}
