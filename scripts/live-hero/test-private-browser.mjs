// Exercise the recorded random draw through the actual candidate handlers. Public GETs
// only; intercept every mutation before it can leave the browser. No signup submission.
import {chromium, webkit} from 'playwright';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const root='output/private-acceptance', base='http://127.0.0.1:8852';
const rows=JSON.parse(readFileSync(`${root}/fetch-results.json`)).filter(r=>r.host!=='caithrin.com');
const results=[];
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();
 try{for(const row of rows){
  const width=engine==='webkit'?390:1440;
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce',serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/api/**',route=>{
   if(['GET','HEAD'].includes(route.request().method()))return route.continue();
   writes.push(new URL(route.request().url()).pathname);
   return route.fulfill({json:{ok:true}});
  });
  const out=`${root}/${row.host}/browser-${engine}`;mkdirSync(out,{recursive:true});
  const result={host:row.host,engine,width,covers:[]};
  try{
   await page.goto(base+'/');await page.locator('#tryurl').fill(row.host);
   await page.waitForFunction(name=>document.querySelector('.hero-book-front .cv-mast').textContent===name,row.identity,{timeout:20000});
   await page.waitForFunction(()=>{const imgs=[...document.querySelectorAll('.hero-book-front img')];return imgs.length&&imgs.every(i=>i.complete&&i.naturalWidth>0)},null,{timeout:12000});
   const logo=await page.locator('.hero-book-front img').evaluateAll(imgs=>imgs.map(i=>({loaded:i.complete&&i.naturalWidth>0,src:i.getAttribute('src')})));
   assert.ok(logo.length&&logo.every(l=>l.loaded),'original hero logo loads');
   await page.screenshot({path:`${out}/hero.png`});
   await page.locator('#trybtn').click();
   await page.waitForFunction(()=>!document.querySelector('#trybtn').disabled,null,{timeout:90000});
   if(!row.selectedPosts && !await page.locator('#preview').evaluate(e=>e.classList.contains('personalized'))){
    assert.match(await page.locator('#tryerr').textContent(),/no public essays/i);
    assert.ok(await page.locator('#tryhandoff').isVisible());
    result.status='Honest no-public-essays path; four designs tested in private print studies.';
    result.pass=true;result.interceptedWrites=writes;results.push(result);
    await page.screenshot({path:`${out}/no-public-essays.png`});
    writeFileSync(`${root}/browser-results.json`,JSON.stringify(results,null,2));
    console.log('PASS',engine,row.host,result.status);await context.close();continue;
   }
   assert.ok(await page.locator('#preview').evaluate(e=>e.classList.contains('personalized')),await page.locator('#tryerr').textContent());
   assert.equal(await page.locator('#pv-mast').textContent(),row.identity);
   result.status=await page.locator('#pv-status').textContent();
   if(!row.selectedPosts)assert.match(result.status,/hand-built|hand built|no.*edition|cannot|not enough/i,'honest no-route state');
   for(const design of ['masthead','classic','field','midnight']){
    await page.locator(`[data-cover=${design}]`).click();
    await page.waitForFunction(()=>{const i=document.querySelector('#pv-logo');return i&&!i.hidden&&i.complete&&i.naturalWidth>0},null,{timeout:12000});
    const state=await page.locator('#pvbook .edition-cover').evaluate(el=>{
     const b=el.getBoundingClientRect();return{title:el.querySelector('.cv-mast').textContent,bad:[...el.children].filter(e=>getComputedStyle(e).display!=='none').filter(e=>{const r=e.getBoundingClientRect();return r.left<b.left-1.5||r.right>b.right+1.5||r.top<b.top-1.5||r.bottom>b.bottom+1.5}).map(e=>e.className),logos:[...el.querySelectorAll('img')].filter(i=>getComputedStyle(i).display!=='none').map(i=>i.complete&&i.naturalWidth>0)};
    });
    assert.equal(state.title,row.identity);assert.deepEqual(state.bad,[],design+' fits');assert.ok(state.logos.length&&state.logos.every(Boolean),design+' logo loads');
    await page.locator('#pvbook').screenshot({path:`${out}/${design}.png`});result.covers.push(design);
   }
   assert.deepEqual(errors,[]);assert.ok(writes.every(w=>w==='/api/event'),'no reservation or feedback even attempted');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page fits viewport');
   result.pass=true;
  }catch(e){result.pass=false;result.error=e.message;await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});}
  result.interceptedWrites=writes;results.push(result);writeFileSync(`${root}/browser-results.json`,JSON.stringify(results,null,2));
  console.log(result.pass?'PASS':'FAIL',engine,row.host,result.error||result.status);await context.close();
 }}finally{await browser.close();}
}
console.log(`${results.filter(r=>r.pass).length}/${results.length} private publication journeys passed`);
process.exitCode=results.some(r=>!r.pass)?1:0;
