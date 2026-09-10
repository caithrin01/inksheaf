#!/usr/bin/env node
// Browser edges for the local launch candidate. Every API response is simulated.
import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { calendar, edited, editorial } from './fixtures/preview-editor-exclusion.mjs';
const base=process.argv[2]||'http://127.0.0.1:8806/';
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Local build required');
const out=process.argv[3]||'output/playwright/states';
mkdirSync(out,{recursive:true});
const browser=await (process.argv[4]==='webkit'?webkit:chromium).launch();
const failures=[], rows=[];
function ok(condition,message){if(!condition)throw new Error(message);}
async function journey(name,options,run){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',...options});
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/preview'?edited:{ok:true}}));
  try {await run(page);ok(errors.length===0,errors.join(' | '));rows.push({name,pass:true});console.log('PASS '+name);}
  catch(e){failures.push(`${name}: ${e.message}`);rows.push({name,pass:false,error:e.message});}
  finally{await context.close();}
}
async function preview(page,host='caithrin.com'){
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('#tryurl').fill(host);await page.locator('#trybtn').click();
  await page.waitForFunction(()=>document.querySelector('#preview').classList.contains('personalized'));
}

for(const [width,height]of [[320,568],[768,1024],[844,390],[1024,768],[2560,1440]]){
  await journey(`title-${width}x${height}`,{viewport:{width,height},reducedMotion:'no-preference'},async page=>{
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.locator('#tryurl').click();
    await page.waitForFunction(()=>document.activeElement?.id==='tryurl');
    await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);
    const geometry=await page.evaluate(()=>{
      const input=document.querySelector('#tryurl').getBoundingClientRect(),button=document.querySelector('#trybtn').getBoundingClientRect();
      return {input:input.top>=0&&input.right<=innerWidth,button:button.bottom<=innerHeight&&button.left>=0,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    ok(geometry.input&&geometry.button&&!geometry.overflow,JSON.stringify(geometry));
    await page.screenshot({path:`${out}/title-${width}x${height}.png`});
  });
}
await journey('no JavaScript offers a visible contact', {javaScriptEnabled:false},async page=>{
  await page.goto(base);
  ok(await page.locator('h1').isVisible(),'headline missing');
  ok(await page.locator('#hero-story a[href^="mailto:"]').isVisible(),'no contact in title page');
  ok(!(await page.locator('#trybtn').isVisible()),'inert preview action still shown');
  ok(!(await page.locator('#fb-form').isVisible()),'nonfunctional feedback form still shown');
  ok(await page.locator('#bookwrap').getAttribute('role')!=='button','inert book announced as a button');
  await page.screenshot({path:`${out}/no-js.png`});
});
await journey('restricted storage and shared publication link',{},async page=>{
  await page.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('Storage unavailable','SecurityError');}}));
  await page.goto(base+'?pub=caithrin.com',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#preview').classList.contains('personalized'));
  ok((await page.locator('#pv-status').textContent()).includes('22 essays'),'preview failed without storage');
});
await journey('normal motion reveals the book without a fixed data replay',{reducedMotion:'no-preference'},async page=>{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('#tryurl').fill('caithrin.com');await page.locator('#trybtn').click();
  await page.waitForFunction(()=>document.querySelector('#preview').classList.contains('personalized'),null,{timeout:2000});
  ok((await page.locator('#tryworking').textContent())==='','loading status remains after the response');
});
await journey('new archive read hides the previous book choices',{},async page=>{
  await preview(page);
  await page.route('**/api/preview?*',async route=>{
    await new Promise(resolve=>setTimeout(resolve,1000));
    await route.fulfill({json:{...edited,host:'other.substack.com',publication:'Another publication'}});
  });
  await page.locator('#tryurl').fill('other.substack.com');await page.locator('#trybtn').click();
  ok(!(await page.locator('.pv-facts').isVisible()),'previous publication choices remain active during the new read');
  await page.waitForFunction(()=>document.querySelector('#pv-mast').textContent==='Another publication');
  ok(await page.locator('.pv-facts').isVisible(),'new publication never appears');
});
await journey('late editor cannot revive a failed publication',{},async page=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/preview?*',route=>route.fulfill({json:route.request().url().includes('broken')?{ok:false,message:'Could not read that archive.'}:calendar}));
  await page.route('**/api/plan?*',async route=>{await pending;await route.fulfill({json:{ok:true,editorial}});});
  await preview(page);
  await page.locator('#tryurl').fill('broken.substack.com');await page.locator('#trybtn').click();
  await page.waitForFunction(()=>!document.querySelector('#tryhandoff').hidden);
  release();await page.waitForTimeout(150);
  ok((await page.locator('#pv-mast').textContent())==='Your publication','old book returned after failure');
  ok(!(await page.locator('#preview').getAttribute('class')).includes('personalized'),'old edition revived');
});
await journey('long masthead and low-contrast publication palette',{},async page=>{
  const data=structuredClone(edited);
  data.publication='Letters about the changing shape of work, technology, and everything we build together';
  data.theme={cover_bg:'#eeeedd',cover_ink:'#ffffff'};
  await page.route('**/api/preview?*',route=>route.fulfill({json:data}));
  await preview(page);await page.evaluate(()=>document.fonts.ready);
  await page.mouse.move(0,0);
  const state=await page.evaluate(()=>{
    const mast=document.querySelector('#pv-mast').getBoundingClientRect(),foot=document.querySelector('#pvbook .cv-footwrap').getBoundingClientRect();
    const style=getComputedStyle(document.querySelector('#pvbook .cover'));const lum=hex=>[1,3,5].map(i=>parseInt(hex.trim().slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const a=lum(style.getPropertyValue('--cover-paper')),b=lum(style.getPropertyValue('--cover-ink'));
    return{fit:mast.bottom<foot.top,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  ok(state.fit&&!state.overflow,'long masthead overlaps the edition details');
  ok(state.contrast>=4.5,'unreadable publication colour retained');
  await page.screenshot({path:`${out}/long-masthead.png`});
});
await journey('hand-plan result has a truthful action and reservation',{},async page=>{
  const data=structuredClone(edited);data.editorial.plan.routes=[];
  await page.route('**/api/preview?*',route=>route.fulfill({json:data}));
  await preview(page);
  ok((await page.locator('#pv-big').textContent()).includes('hand plan'),'hand-plan headline missing');
  ok((await page.locator('#pv-status').textContent()).includes('needs a hand-built plan'),'unavailable binding announced ready');
  ok((await page.locator('#pv-price').textContent())==='','infeasible plan given a price');
  await page.locator('#pv-cta').click();
  const plan=JSON.parse(await page.locator('#plan_json').inputValue());
  ok(plan.needs_hand_plan&&plan.cadence==='concierge','hand-plan request lost');
});
await journey('older preview responses follow the selected division',{},async page=>{
  const data=structuredClone(edited);delete data.editorial;
  const volume=(pages,posts)=>({label:'2025–26',est_pages:pages,posts,words:10000,from:data.from,to:data.to});
  data.divisions={single:{feasible:true,volumes:[volume(160,22)]},
    quarterly:{feasible:true,volumes:[volume(90,10),volume(100,12)]},monthly:{feasible:false,reason:'Too few posts',volumes:[]}};
  data.recommended={cadence:'single',interior:'bw'};
  await page.route('**/api/preview?*',route=>route.fulfill({json:data}));
  await preview(page);
  await page.getByRole('tab',{name:'Quarterly',exact:true}).click();
  ok((await page.locator('#pv-status').textContent()).includes('190 estimated pages'),'old response retains archive page estimate');
  await page.locator('#pv-cta').click();
  ok((await page.locator('#carried').textContent()).includes('190 pages'),'old response reservation disagrees with the selected division');
});
await journey('editor may replace a binding with a hand plan',{},async page=>{
  const hand=structuredClone(editorial);hand.plan.routes=[];
  await page.route('**/api/preview?*',route=>route.fulfill({json:calendar}));
  await page.route('**/api/plan?*',async route=>{
    await new Promise(resolve=>setTimeout(resolve,250));await route.fulfill({json:{ok:true,editorial:hand}});
  });
  await preview(page);
  await page.waitForFunction(()=>document.querySelector('#pv-big').textContent.includes('hand plan'));
  ok((await page.locator('#pv-status').textContent()).includes('needs a hand-built plan'),'editor hand plan not announced');
  ok((await page.locator('#pv-cvpages').textContent())==='Binding to be planned','cover still promises the abandoned binding');
  ok((await page.locator('#pv-price').textContent())==='','old price survives the hand plan');
});
await journey('a saved free request never introduces a verification step',{},async page=>{
  await page.route('**/api/signup',route=>route.fulfill({json:{ok:true,id:101,press:'queued'}}));
  await preview(page);await page.locator('#pv-cta').click();await page.locator('#email').fill('reader@example.com');
  await page.locator('#f button[type=submit]').click();await page.locator('#done').waitFor({state:'visible'});
  ok((await page.locator('#done-verify').textContent()).includes('email your complete PDF'),'PDF delivery missing');
  ok(await page.locator('#alt-start,#verify-resend').count()===0,'verification gate returned');
});
await journey('deduplicated reservation does not claim a new email was sent',{},async page=>{
  await page.route('**/api/signup',route=>route.fulfill({json:{ok:true}}));
  await preview(page);await page.locator('#pv-cta').click();
  await page.locator('#email').fill('reader@example.com');await page.locator('#f button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#done').style.display==='block');
  ok(!(await page.locator('#done-verify').textContent()).includes('We sent'),'acknowledgement invents a new delivery');
  ok((await page.locator('#done-h').textContent())==='Your edition is saved.','request not acknowledged');
});
await browser.close();writeFileSync(`${out}/results.json`,JSON.stringify({simulated:true,rows,failures},null,2));
console.log(failures.length?`LAUNCH STATES: ${failures.length} failures\n${failures.join('\n')}`:`LAUNCH STATES: ${rows.length} journeys passed`);
process.exitCode=failures.length?1:0;
