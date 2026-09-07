#!/usr/bin/env node
// Bound the delivered motion payload and verify the actual one-shot animation, not its label.
import {readFileSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(new URL('..',import.meta.url).pathname),dir=resolve(root,'public/motion');
const manifest=JSON.parse(readFileSync(`${dir}/manifest.json`));
let pass=0,fail=0;
function check(ok,label){if(ok){pass++;console.log('PASS '+label);}else{fail++;console.error('FAIL '+label);}}
function animation(buffer){
 let offset=12,loops=null,frames=0,duration=0;
 while(offset+8<=buffer.length){
  const id=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4),data=offset+8;
  if(id==='ANIM')loops=buffer.readUInt16LE(data+4);
  if(id==='ANMF'){frames++;duration+=buffer.readUIntLE(data+12,3);}
  offset=data+size+(size%2);
 }
 return {loops,frames,duration};
}
for(const [lane,entry]of Object.entries(manifest.lanes)){
 let preferred=0;
 for(const [name,expected]of Object.entries(entry.files)){
  const path=`${dir}/${name}`;check(existsSync(path),`${name} exists`);if(!existsSync(path))continue;
  const data=readFileSync(path);
  check(data.length===expected.bytes&&createHash('sha256').update(data).digest('hex')===expected.sha256,`${name} matches reviewed asset`);
  if(name.endsWith('.avif')){preferred+=data.length;check(data.length<=120000,`${name} poster stays below 120 kB`);}
  if(name.endsWith('-opening.webp')){
   preferred+=data.length;const a=animation(data);
   check(a.loops===1,`${lane} opening plays once`);
   check(a.frames===24,`${lane} has a complete 24-frame opening`);
   check(Math.abs(a.duration-800)<=16,`${lane} completes in 800 ms (${a.duration} ms)`);
  }
 }
 check(preferred<=(lane==='desk'?750000:1000000),`${lane} preferred path stays within its payload budget (${Math.round(preferred/1000)} kB)`);
}
const component=readFileSync(resolve(root,'src/components/ScrollHero.astro'),'utf8');
check(!component.includes('data:image/'),'no inline photographic payload');
check(!component.includes('/storyboard/'),'retired four-scene sequence is not fetched');
check(component.includes('prefers-reduced-motion')&&component.includes('saveData'),'motion has reduced-motion and data-saving fallbacks');
check(existsSync(resolve(root,'scripts/motion/render-book.py'))&&existsSync(resolve(root,'scripts/motion/asset-prompts.md')),'render recipe and image prompts are durable');
console.log(`hero assets: ${pass} pass, ${fail} fail`);process.exitCode=fail?1:0;
