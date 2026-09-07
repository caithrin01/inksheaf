#!/usr/bin/env node
// Encode one deterministic opening as a once-playing WebP. No video runtime or frame buffer.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(new URL('../..',import.meta.url).pathname),out=resolve(root,'public/motion');mkdirSync(out,{recursive:true});
const manifest={duration_ms:800,frames:24,loops:1,lanes:{}};
const run=args=>execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error',...args],{stdio:'inherit'});
for(const [lane,folder]of [['desk','desktop'],['portrait','portrait']]){
 const source=resolve(root,'assets/motion',folder),files=[];
 for(const [state,n]of [['closed','00'],['ready','23']]){
  for(const format of ['avif','webp']){
   const name=`${lane}-${state}.${format}`;
   run(['-i',`${source}/frame-${n}.png`,...format==='avif'?['-c:v','libaom-av1','-still-picture','1','-crf','28','-cpu-used','6','-pix_fmt','yuv420p']:['-c:v','libwebp','-quality','86','-compression_level','6'],`${out}/${name}`]);
   files.push(name);
  }
 }
 if(process.argv.includes('--posters'))continue;
 const opening=`${lane}-opening.webp`;
 run(['-framerate','30','-i',`${source}/frame-%02d.png`,'-frames:v','24','-c:v','libwebp_anim','-quality','82','-compression_level','6','-loop','1',`${out}/${opening}`]);files.push(opening);
 manifest.lanes[lane]={...JSON.parse(readFileSync(`${source}/page.json`)),files:Object.fromEntries(files.map(name=>[name,{bytes:statSync(`${out}/${name}`).size,sha256:createHash('sha256').update(readFileSync(`${out}/${name}`)).digest('hex')}]))};
 console.log(lane,files.map(name=>`${name}: ${Math.round(statSync(`${out}/${name}`).size/1000)} kB`).join(', '));
}
if(!process.argv.includes('--posters'))writeFileSync(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
