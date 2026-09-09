#!/usr/bin/env node
// Current product journeys with real public GETs. Works on a local candidate,
// a deployment URL or production. No email, reservation or feedback is sent.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import * as pw from 'playwright';
const engineName=process.argv[2]||'chromium',base=(process.argv[3]||'https://inksheaf.com').replace(/\/$/,'');
const out=process.env.INKSHEAF_JOURNEY_OUT||`output/playwright/launch/real-journeys-${engineName}`;await mkdir(out,{recursive:true});
const browser=await pw[engineName].launch(),results=[];
async function journey(name,options,fn){
 const context=await browser.newContext({viewport:options.mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:!!options.mobile,colorScheme:options.mobile?'dark':'light',javaScriptEnabled:!options.noJs,reducedMotion:'reduce',serviceWorkers:'block'});
 const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/api/**',route=>{
  const req=route.request();if(['GET','HEAD'].includes(req.method()))return route.continue();
  const path=new URL(req.url()).pathname;writes.push(path);
  // The handoff payload is tested, but never sent to the live service.
  if(path==='/api/event'||path==='/api/signup')return route.fulfill({json:{ok:true,press:'test'}});
  return route.abort();
 });
 try{await fn(page,writes);assert.deepEqual(errors,[],'browser exceptions');assert.ok(writes.every(p=>['/api/event','/api/signup'].includes(p)),'unexpected mutation');await page.screenshot({path:`${out}/${name}.png`});results.push({name,pass:true,interceptedWrites:writes});console.log('PASS',name)}
 catch(e){results.push({name,pass:false,error:e.message,interceptedWrites:writes});await page.screenshot({path:`${out}/${name}-failed.png`}).catch(()=>{});console.log('FAIL',name,e.message)}finally{await context.close()}
}
async function preview(page,host='caithrin.com',navigate=true){
 if(navigate)await page.goto(base+'/');
 await page.locator('#tryurl').fill(host);
 const reply=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/preview',{timeout:60000});
 await page.locator('#trybtn').click();
 const payload=await reply.then(r=>r.json()).catch(()=>({}));
 await page.waitForFunction(()=>!document.querySelector('#trybtn').disabled,null,{timeout:60000});
 assert.equal(await page.locator('#preview').evaluate(e=>e.classList.contains('personalized')),true,JSON.stringify({message:await page.locator('#tryerr').textContent(),error:payload.error,upstream:payload.upstream,attempts:payload.attempts}));
 await page.waitForFunction(()=>/ready|planned|hand-built/.test(document.querySelector('#pv-status').textContent));
}
async function editionAgrees(page){
 const state=await page.evaluate(()=>Object.fromEntries(['pv-mast','pv-sub','pv-status','pv-dates','pv-cvpages','pv-price'].map(id=>[id,document.getElementById(id).textContent])));
 assert.equal(state['pv-mast'],'caithrin');
 const pages=state['pv-sub'].match(/(\d+) estimated pages/),posts=state['pv-sub'].match(/^(\d+) essays/);
 assert.ok(pages&&posts,'edition quantities present');assert.ok(state['pv-status'].includes(pages[1]+' estimated pages'),'announced pages agree');assert.ok(state['pv-status'].includes(posts[1]+' essays'),'announced posts agree');assert.ok(state['pv-sub'].includes(state['pv-dates']),'cover span agrees');
 assert.match(state['pv-price'],/Estimated printing:.*\$\d/);assert.match(state['pv-price'],/Shipping:.*\$\d/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');
}
await journey('opening',{},async page=>{await page.goto(base+'/');const r=await page.locator('#tryurl').boundingBox();assert.ok(r.y+r.height<1000,'entry visible on load');assert.ok(await page.locator('.hero-book-front .cv-mast').isVisible());assert.equal(await page.locator('.press-specimen .cover-face').count(),2)});
for(const mobile of [false,true])await journey(mobile?'mobile-edition':'desktop-edition',{mobile},async page=>{await preview(page);await editionAgrees(page);assert.equal(await page.evaluate(()=>document.activeElement.id),'bookwrap');const y=await page.locator('#preview').evaluate(e=>e.getBoundingClientRect().top);assert.ok(y>=-1&&y<100,'preview reveal lands once');assert.ok(await page.locator('.desk-tab[aria-selected=true]').count());});
await journey('cover-designs',{},async page=>{await preview(page);for(const design of ['masthead','classic','field','midnight']){await page.locator(`[data-cover=${design}]`).click();assert.equal(await page.locator(`[data-cover=${design}]`).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#pv-mast').textContent(),'caithrin');const fit=await page.locator('#pvbook .edition-cover').evaluate(el=>{const b=el.getBoundingClientRect();return [...el.children].filter(e=>getComputedStyle(e).display!=='none').every(e=>{const r=e.getBoundingClientRect();return r.top>=b.top-1&&r.bottom<=b.bottom+1})});assert.ok(fit,design+' content fits')}});
await journey('sample-keyboard-and-status',{},async page=>{await preview(page);await page.locator('#bookwrap').focus();await page.keyboard.press('Enter');await page.locator('#sample-frame').waitFor({state:'visible',timeout:20000});const frame=page.frames().find(f=>f.url().includes('/reader/'));assert.ok(frame,'reader frame loads');await frame.locator('#reading .artbody p').first().waitFor({timeout:20000});await page.waitForFunction(()=>document.querySelector('#sample-status').textContent==='',null,{timeout:3000});assert.equal(await frame.locator('#status').textContent(),'','reader loading message clears when text is visible');await page.locator('#view-cover').click();assert.equal(await page.locator('#view-cover').getAttribute('aria-pressed'),'true')});
await journey('cadence-consistency',{},async page=>{await preview(page);const tabs=await page.locator('.desk-tab:not(:disabled)').count();for(let i=0;i<tabs;i++){await page.locator('.desk-tab:not(:disabled)').nth(i).click();await editionAgrees(page)}const disabled=page.locator('.desk-tab:disabled');if(await disabled.count())assert.match(await page.locator('#desk-verdict').textContent(),/ruled out|minimum|no posts|too|thin|under|past/i)});
await journey('handoff-payload-no-email',{},async(page,writes)=>{await preview(page);await page.locator('#pv-cta').click();const plan=JSON.parse(await page.locator('#plan_json').inputValue());assert.ok(plan.cadence&&plan.volumes?.length);assert.match(await page.locator('#carried').textContent(),/caithrin/i);assert.equal(writes.filter(p=>p==='/api/signup').length,0)});
await journey('replace-publication',{},async page=>{await preview(page);await preview(page,'manifund.substack.com',false);assert.equal(await page.locator('#pv-mast').textContent(),'The Fox Says');assert.doesNotMatch(await page.locator('#pv-sub').textContent(),/caithrin/i)});
await journey('failure-clears-preview',{},async page=>{await preview(page);await page.locator('#tryurl').fill('javascript:alert(1)');await page.locator('#trybtn').click();await page.waitForFunction(()=>!document.querySelector('#trybtn').disabled);assert.equal(await page.locator('#preview').evaluate(e=>e.classList.contains('personalized')),false);assert.match(await page.locator('#tryerr').textContent(),/publication URL/i);assert.ok(await page.locator('.hero-book-front').isVisible());assert.equal(await page.locator('#plan_json').inputValue(),'')});
await journey('deep-link',{},async page=>{await page.goto(base+'/?pub=caithrin.com');await page.waitForFunction(()=>document.querySelector('#preview').classList.contains('personalized'),null,{timeout:60000});await editionAgrees(page)});
await journey('accessible-names',{},async page=>{await preview(page);const tree=await page.locator('body').ariaSnapshot();assert.doesNotMatch(tree,/[❦❧]/);assert.ok(await page.getByRole('textbox',{name:'Your publication URL',exact:true}).count());assert.ok(tree.includes('button "Make this book"'));assert.match(await page.locator('#pv-status').textContent(),/\d+ essays.*\d+ estimated pages/)});
await journey('no-javascript',{noJs:true},async page=>{await page.goto(base+'/');assert.ok(await page.locator('h1').isVisible());assert.ok(await page.locator('.hero-book-front').isVisible());assert.ok(await page.locator('noscript a[href="mailto:caithrin@caithrin.com"]').first().isVisible());assert.equal(await page.locator('#tryurl').isVisible(),false)});
await browser.close();await writeFile(`${out}/results.json`,JSON.stringify({base,engine:engineName,mode:'Real public reads; all mutations intercepted',results},null,2)+'\n');
console.log(`JOURNEY GATE: ${results.filter(r=>r.pass).length}/${results.length} passed`);process.exitCode=results.some(r=>!r.pass)?1:0;
