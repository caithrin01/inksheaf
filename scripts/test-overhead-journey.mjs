#!/usr/bin/env node
// Local acceptance for the overhead product flow. All API effects are simulated.
import {chromium,webkit} from 'playwright';import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {edited} from './fixtures/preview-editor-exclusion.mjs';
const base=process.argv[2]||'http://127.0.0.1:8809/';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local only');
const out=process.argv[3]||'output/playwright/overhead';mkdirSync(out,{recursive:true});
const sample=JSON.parse(readFileSync('scripts/fixtures/public-sample-caithrin.json'));const identity=JSON.parse(readFileSync('scripts/fixtures/publication-caithrin.json'));const axeSource=readFileSync('node_modules/axe-core/axe.min.js','utf8');const rows=[];
const check=(condition,message)=>{if(!condition)throw Error(message);};
for(const [name,type]of[['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();try{for(const width of [1280,390]){
 const p=await browser.newPage({viewport:{width,height:width===390?844:900},reducedMotion:width===390?'reduce':'no-preference'});const errors=[];p.on('pageerror',e=>errors.push(e.message));let events=[];
 await p.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;
 if(path==='/api/preview')return route.fulfill({json:{...edited,logo_url:identity.logo_url,theme:identity.theme}});
 if(path==='/api/sample')return route.fulfill({json:sample});
 events.push(path);return route.fulfill({json:{ok:true,press:'test'}});});
 // Exercise the asynchronous iframe handoff even on a fast local machine.
 await p.addInitScript(()=>{
   let delayed=false;
   addEventListener('message',event=>{
     if(location.pathname!=='/reader/'||delayed||event.data?.type!=='sample-view'||event.data.mode!=='print')return;
     delayed=true;event.stopImmediatePropagation();
     const {data,origin}=event;setTimeout(()=>dispatchEvent(new MessageEvent('message',{data,origin})),200);
   });
 });
 await p.goto(base);await p.waitForTimeout(700);
 const hero=await p.locator('#tryurl').boundingBox();check(hero.y+hero.height<844,'URL field is not immediately visible');
 check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'hero overflow');
 await p.locator('#tryurl').fill('caithrin.com');await p.locator('#trybtn').click();await p.waitForFunction(()=>document.querySelector('#preview').classList.contains('personalized'));
 for(const design of ['masthead','classic','field','midnight']){
 await p.locator(`[data-cover=${design}]`).click();await p.locator('#pv-cta').click();
 const plan=JSON.parse(await p.locator('#plan_json').inputValue());check(plan.design.cover===design&&plan.design.version===2,'reservation loses design');
 }
 await p.locator('#preview').scrollIntoViewIfNeeded();await p.locator('#view-sample').focus();await p.keyboard.press('Enter');
 await p.waitForFunction(()=>document.querySelector('#sample-position').textContent==='Text excerpt');
 await p.locator('#sample-mode').click();
 await p.waitForFunction(()=>document.querySelector('#sample-position').textContent==='1 / 4');
 const frame=p.frames().find(f=>f.url().includes('/reader/'));
 // The parent updates its counter before the iframe receives sample-view. Wait
 // for the actual print page, not just the parent counter, before reading it.
 await frame.locator('.pagedjs_page.active').waitFor({state:'visible'});
 check((await frame.locator('.pagedjs_page.active').innerText()).includes('On the surface'),'first page is blank or invented');
 await p.evaluate(()=>document.querySelector('#sample-frame').contentWindow.postMessage({type:'sample-turn',delta:1,channel:'wrong'},location.origin));await p.waitForTimeout(60);check(await p.locator('#sample-position').textContent()==='1 / 4','unauthenticated reader message accepted');
 const text=await frame.locator('.pagedjs_page.active').innerText();await p.locator('#sample-next').click();
 await p.waitForFunction(()=>document.querySelector('#sample-position').textContent==='2 / 4');
 check((await frame.locator('.pagedjs_page.active').innerText())!==text,'page did not turn');
 await p.locator('#sample-enlarge').click();check(await p.locator('[role=dialog]').isVisible(),'Enlarge did not open');
 await p.locator('#sample-scale').click();await frame.waitForFunction(()=>Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('#pages')).transform).a-1)<.01,null,{timeout:3000});
 await frame.locator('body').evaluate(el=>{el.tabIndex=-1;el.focus();});await p.keyboard.press('Tab');
 await p.waitForFunction(()=>document.activeElement?.id==='view-cover');
 await frame.locator('body').evaluate(el=>el.focus());await p.keyboard.press('Shift+Tab');
 await p.waitForFunction(()=>document.activeElement?.id==='sample-scale');
 await frame.locator('body').evaluate(el=>el.focus());await p.keyboard.press('Escape');await p.locator('[role=dialog]').waitFor({state:'detached'});
 check(await p.evaluate(()=>document.activeElement?.id==='sample-enlarge'),'Escape from sample did not restore focus');check(await p.evaluate(()=>!document.querySelector('.pv-facts').inert),'background remained inert');
 await p.locator('#view-cover').click();check(await p.locator('#pv-mast').isVisible(),'return to cover failed');
 await p.addScriptTag({content:axeSource});const axe=await p.evaluate(()=>window.axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));check(!axe.violations.length,'axe: '+axe.violations.map(x=>x.id).join(','));
 check(!errors.length,errors.join(';'));check(!events.includes('/api/signup'),'test unexpectedly submitted');
 rows.push({browser:name,width,pass:true,pages:4,designs:4,axe:0});console.log('PASS',name,width);await p.screenshot({path:`${out}/${name}-${width}.png`});await p.close();
 }}finally{await browser.close();}
}
writeFileSync(`${out}/results.json`,JSON.stringify(rows,null,2));
