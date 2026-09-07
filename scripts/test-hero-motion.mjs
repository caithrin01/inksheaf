#!/usr/bin/env node
// Real-time motion acceptance against a local build. APIs never leave this fixture.
import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { edited } from './fixtures/preview-editor-exclusion.mjs';
const base=process.argv[2]||'http://127.0.0.1:8806/';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local build required');
const out=process.argv[3]||'output/playwright/motion';mkdirSync(out,{recursive:true});
const browser=await(process.argv[4]==='webkit'?webkit:chromium).launch();
const rows=[],failures=[];
const axeSource=readFileSync(new URL('../node_modules/axe-core/axe.min.js',import.meta.url),'utf8');
function check(ok,message){if(!ok)throw Error(message);}
async function run(name,options,fn){
 const context=await browser.newContext({viewport:{width:1280,height:800},...options});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/preview'?edited:{ok:true}}));
 try{await fn(page);check(!errors.length,errors.join(' | '));rows.push({name,pass:true});console.log('PASS '+name);}
 catch(e){rows.push({name,pass:false,error:e.message});failures.push(`${name}: ${e.message}`);console.error('FAIL '+name+': '+e.message);}
 finally{await context.close();}
}
try{
 for(const [width,height]of [[1280,800],[390,844]]){
  await run(`one complete opening ${width}`,{viewport:{width,height}},async page=>{
   await page.goto(base);await page.waitForFunction(()=>document.querySelector('#hero-story').dataset.motionReady==='true');
   check(await page.evaluate(()=>document.querySelector('#hero-story').offsetHeight<=innerHeight*2),'hero exceeds two screen heights');
   await page.evaluate(()=>document.fonts.ready);
   check(await page.locator('.sheaf-line').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),'opening caption is clipped');
   await page.screenshot({path:`${out}/closed-${width}.png`});
   await page.mouse.wheel(0,120);
   await page.waitForFunction(()=>document.querySelector('#hero-story').dataset.phase==='opening');
   await page.waitForTimeout(220);await page.screenshot({path:`${out}/opening-${width}.png`});
   await page.waitForFunction(()=>document.querySelector('#hero-story').dataset.phase==='ready',null,{timeout:1500});
   const readyShot=await page.screenshot({path:`${out}/ready-${width}.png`});
   // Check the painted page, not only DOM visibility: an async poster can be present
   // with opacity 1 while its first visible frame is still an empty dark background.
   const paperLight=await page.evaluate(async encoded=>{
    const shot=new Image();shot.src='data:image/png;base64,'+encoded;await shot.decode();
    const canvas=document.createElement('canvas');canvas.width=shot.width;canvas.height=shot.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(shot,0,0);
    const r=document.querySelector('#tryit').getBoundingClientRect();
    const pixels=ctx.getImageData(Math.round(r.x+3),Math.round(r.y+3),8,8).data;
    let total=0;for(let i=0;i<pixels.length;i+=4)total+=(pixels[i]+pixels[i+1]+pixels[i+2])/3;
    return total/(pixels.length/4);
   },readyShot.toString('base64'));
   check(paperLight>130,'opening finishes without a painted paper surface: '+paperLight);
   // Stop and reverse just across the trigger: the completed book must not flap.
   await page.mouse.wheel(0,-70);await page.waitForTimeout(100);await page.mouse.wheel(0,80);await page.waitForTimeout(150);
   check(await page.locator('#hero-story').getAttribute('data-openings')==='1','scroll reversal replayed the opening');
   await page.locator('#hero-try').click();
   check(await page.evaluate(()=>document.activeElement?.id==='tryurl'),'header action does not focus immediately');
   const before=await page.locator('#tryurl').boundingBox();
   await page.route('**/api/preview?*',async route=>{await new Promise(r=>setTimeout(r,900));await route.fulfill({json:{ok:false,message:'Could not read that archive.'}});});
   await page.locator('#tryurl').fill('broken.substack.com');await page.locator('#trybtn').click();
   await page.waitForTimeout(100);
   const working=await page.locator('#tryurl').boundingBox();
   check(Math.abs(working.y-before.y)<2,'loading moves the publication field');
   await page.locator('#tryhandoff').waitFor({state:'visible'});
   const error=await page.locator('#tryurl').boundingBox();
   check(Math.abs(error.y-before.y)<2,'error moves the publication field');
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
  });
 }
 await run('header skips motion even during opening',{},async page=>{
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#hero-story').dataset.motionReady==='true');
  await page.mouse.wheel(0,120);await page.waitForFunction(()=>document.querySelector('#hero-story').dataset.phase==='opening');
  await page.locator('#hero-try').click();
  check(await page.evaluate(()=>document.querySelector('#hero-story').dataset.phase==='ready'&&document.activeElement?.id==='tryurl'),'CTA waits for motion');
  await page.locator('#tryurl').fill('writing remains here');await page.waitForTimeout(1000);
  check(await page.locator('#tryurl').inputValue()==='writing remains here','late completion disrupts typing');
 });
 await run('motion asset failure goes directly to usable title',{},async page=>{
  await page.route('**/motion/*-opening.webp*',route=>route.abort());await page.goto(base);await page.mouse.wheel(0,140);
  await page.waitForFunction(()=>document.querySelector('#hero-story').dataset.phase==='ready');
  await page.locator('#tryurl').fill('caithrin.com');check(await page.locator('#trybtn').isVisible(),'fallback lost action');
 });
 await run('compact viewport preserves typing and a usable action',{viewport:{width:320,height:568}},async page=>{
  await page.goto(base);await page.locator('#hero-try').click();await page.locator('#tryurl').fill('caithrin.com');
  await page.setViewportSize({width:320,height:340});await page.waitForTimeout(150);
  const state=await page.evaluate(()=>{const f=document.querySelector('#tryurl'),b=document.querySelector('#trybtn').getBoundingClientRect();return{focused:document.activeElement===f,value:f.value,size:parseFloat(getComputedStyle(f).fontSize),action:b.top>=0&&b.bottom<=innerHeight,phase:document.querySelector('#hero-story').dataset.phase};});
  check(state.focused&&state.value==='caithrin.com'&&state.size>=16&&state.action&&state.phase==='ready',JSON.stringify(state));
  const form=await page.locator('#tryit').boundingBox(),header=await page.locator('.sheaf-header').boundingBox();
  check(form.y>=header.y+header.height&&form.y+form.height<=340,'compact invitation is clipped or covered by the header');
  check(await page.locator('#trybtn').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.bottom-3)===el;}),'compact action is covered by later content');
  await page.addScriptTag({content:axeSource});
  const a=await page.evaluate(()=>window.axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
  check(!a.violations.length,a.violations.map(v=>v.id).join(', '));
  await page.screenshot({path:`${out}/compact-typing.png`});
 });
 await run('reduced motion does not fetch the animation',{reducedMotion:'reduce'},async page=>{
  const animationRequests=[];page.on('request',req=>{if(req.url().includes('-opening.webp'))animationRequests.push(req.url());});
  await page.goto(base);check(await page.locator('#hero-story').getAttribute('data-phase')==='ready','not immediately ready');
  check(!animationRequests.length,'unnecessary motion download');
 });
 await run('personal book opens only on deliberate input',{},async page=>{
  await page.goto(base);await page.locator('#hero-try').click();await page.locator('#tryurl').fill('caithrin.com');await page.locator('#trybtn').click();
  await page.waitForFunction(()=>document.querySelector('#preview').classList.contains('personalized'));
  await page.locator('#bookwrap').hover();await page.waitForTimeout(700);
  check(await page.locator('#bookwrap').getAttribute('aria-pressed')==='false','hover opens book');
  const start=await page.evaluate(()=>scrollY);await page.locator('#bookwrap').click();await page.waitForTimeout(650);
  check(await page.locator('#bookwrap').getAttribute('aria-pressed')==='true','click did not open');
  await page.mouse.move(0,0);await page.waitForTimeout(200);
  check(await page.locator('#bookwrap').getAttribute('aria-pressed')==='true','pointer exit closes book');
  check(Math.abs(await page.evaluate(()=>scrollY)-start)<2,'opening causes a scroll jump');
  await page.locator('#bookwrap').focus();await page.keyboard.press('Space');
  check(await page.locator('#bookwrap').getAttribute('aria-pressed')==='false','keyboard state disagrees');
 });
}finally{await browser.close();}
writeFileSync(`${out}/results.json`,JSON.stringify({simulated:true,rows,failures},null,2));
console.log(`HERO MOTION: ${rows.filter(r=>r.pass).length} passed, ${failures.length} failed`);process.exitCode=failures.length?1:0;
