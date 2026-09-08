import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {coverMarkup,coverStyle} from '../functions/lib/book-design.js';
import {edited} from './fixtures/preview-editor-exclusion.mjs';
const base=process.argv[2]||'http://127.0.0.1:8850/';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Synthetic identity stress test: local only. Use test-journeys.mjs for real public reads.');
const out=process.argv[3]||'output/playwright/live-publication';await mkdir(out,{recursive:true});
const actual=JSON.parse(await readFile('scripts/fixtures/publication-thezvi.json','utf8'));
const titles=[actual.publication,'The Collected Thoughts of Someone Who Has Quite a Lot to Say','Observations on Technology, Culture, Politics, and the Peculiar Business of Being Human','A Very Long Publication Name With a Subtitle: Dispatches from the Edges of an Increasingly Complicated World',
 'W'.repeat(120),'i'.repeat(120),'The Extraordinary Adventures of Supercalifragilisticexpialidocious',
 '關於科技文化與日常生活的長篇觀察與思考以及我們如何共同創造更美好的未來'.repeat(2),
 'تأملات طويلة في التكنولوجيا والثقافة والحياة اليومية والمستقبل الذي نصنعه معاً',
 'Letters 🌿 from the World 🌍 of Ideas — and Everything Between ✨','Don’t Worry About the Vase & Other “Small” Things', '<img src=x onerror=alert(1)> & Writing'];
const logo='/book/caithrin-mark-charcoal.svg';
const treatments=[{name:'absent',logo:''},{name:'transparent',logo},{name:'opaque',logo,logoTreatment:'band',logoBackground:'#1d1e1d',logoInk:'#f2efe5'}];
const results=[],failures=[];let fitCount=0;
function check(ok,msg){if(!ok)failures.push(msg)}
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();
 try{for(const width of [320,390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:width<768?844:1000},reducedMotion:'reduce'});const errors=[];const requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  let pending=[],metadata={...actual}, mode='normal';
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()); requests.push({method:route.request().method(),path:url.pathname});
   if(url.pathname==='/api/publication'){
    const host=url.searchParams.get('url');if(mode==='held'){pending.push({route,host});return;}
    return route.fulfill({status:mode==='failure'?503:200,json:{...metadata,host}});
   }
   return route.fulfill({json:url.pathname==='/api/preview'?{...edited,...metadata}:{ok:true}});
  });
  await page.goto(base);await page.evaluate(()=>document.fonts.ready);const input=page.locator('#tryurl'),mast=page.locator('.hero-book-front .cv-mast');
  await input.focus();await input.pressSequentially('thezvi',{delay:25});
  assert.equal(await mast.textContent(),'thezvi');assert.equal(await page.locator('.press-specimen img[src]').count(),0,'old logo removed on the first keystroke');
  await page.waitForTimeout(700);assert.equal(requests.filter(r=>r.path==='/api/publication').length,0,'no requests for partial names');
  await input.pressSequentially('.substack.com',{delay:20});
  await page.waitForFunction(title=>document.querySelector('.hero-book-front .cv-mast').textContent===title,actual.publication);
  assert.equal(requests.filter(r=>r.path==='/api/publication').length,1,'one debounced metadata read');
  assert.equal(await input.evaluate(e=>e===document.activeElement),true,'caret stays in input');
  assert.equal(await page.locator('.press-specimen img[src]').count(),0,'actual publication has no logo; do not invent one');
  await page.screenshot({path:`${out}/${engine}-vase-${width}.png`});
  // Three logo situations, including the no-logo identity actually returned by thezvi.
  for(let t=0;t<titles.length;t++)for(const treatment of treatments){
   const host=`fixture${t}${treatment.name}.substack.com`;await input.fill(host);
   await page.evaluate(({raw,publication,title,logo,treatment})=>document.dispatchEvent(new CustomEvent('hero-publication-preview',{detail:{raw,publication:{...publication,host:raw,publication:title,logo_url:logo||null,logo_treatment:treatment==='opaque'?{treatment:'band',background:'#1d1e1d'}:{treatment:'transparent'}}}})),{raw:host,publication:actual,title:titles[t],logo:treatment.logo,treatment:treatment.name});
   // The same cover primitives used by hero, preview and printed covers. Measure all four
   // with actual browser font metrics; no clipping/ellipsis can hide a passing title.
   const markup=['masthead','classic','field','midnight'].map(design=>`<div class="cover-face" data-design="${design}" style="${coverStyle(design,actual.theme,titles[t])};width:${width<768?Math.round(width*.64):280}px">${coverMarkup({publication:titles[t],...treatment})}</div>`).join('');
   await page.evaluate(html=>{let lab=document.getElementById('fit-lab');if(!lab){lab=document.createElement('div');lab.id='fit-lab';lab.style.cssText='position:absolute;left:0;top:2000px;display:flex;flex-wrap:wrap;gap:20px;width:100%;background:#e4e5de;padding:10px;box-sizing:border-box';document.body.append(lab)}lab.innerHTML=html},markup);
   const fit=await page.evaluate(()=>{
    const rotated=[...document.querySelectorAll('.hero-book')];const old=rotated.map(e=>e.style.transform);rotated.forEach(e=>e.style.transform='none');
    const data=[...document.querySelectorAll('.press-specimen .cover-face,#fit-lab .cover-face')].filter(e=>e.getBoundingClientRect().width>0).map(face=>{
     const el=face.querySelector('.edition-cover'),b=el.getBoundingClientRect();
     const bad=[...el.children].filter(e=>getComputedStyle(e).display!=='none').filter(e=>{const r=e.getBoundingClientRect();return r.left<b.left-1.2||r.right>b.right+1.2||r.top<b.top-1.2||r.bottom>b.bottom+1.2||e.scrollWidth>e.clientWidth+1}).map(e=>e.className);
     return{design:face.dataset.design,width:b.width,ratio:b.width/b.height,title:face.querySelector('.cv-mast').textContent,bad,font:parseFloat(getComputedStyle(face.querySelector('.cv-mast')).fontSize)};
    });rotated.forEach((e,i)=>e.style.transform=old[i]);return{data,overflow:document.documentElement.scrollWidth>innerWidth};
   });
   for(const f of fit.data){fitCount++;check(!f.bad.length,`${engine}/${width}/${t}/${treatment.name}/${f.design}: ${f.bad}`);check(Math.abs(f.ratio-2/3)<.006,'6x9 proportion');check(f.title===titles[t],'complete title retained');}
   check(!fit.overflow,`${engine}/${width}/${t}: page overflow`);
   if(engine==='chromium'&&[390,1440].includes(width)&&[0,2,4,7,8].includes(t)&&treatment.name==='opaque'){
    await page.screenshot({path:`${out}/stress-${width}-${t}.png`});
    if(width===1440)await page.locator('#fit-lab').screenshot({path:`${out}/all-covers-${t}.png`});
   }
  }
  await page.locator('#fit-lab').evaluate(e=>e.remove());
  await input.fill('');assert.equal(await mast.textContent(),'caithrin');assert.equal(await page.locator('.press-specimen img[src]').count(),2);
  // Resolve the second request first; the old request must never repaint either title or logo.
  mode='held';await input.fill('older.substack.com');await page.waitForTimeout(750);await input.fill('newer.substack.com');await page.waitForTimeout(750);
  assert.equal(pending.length,2);await pending[1].route.fulfill({json:{ok:true,host:pending[1].host,publication:'Newer title',logo_url:logo}});
  await page.waitForFunction(()=>document.querySelector('.hero-book-front .cv-mast').textContent==='Newer title');
  await pending[0].route.fulfill({json:{ok:true,host:pending[0].host,publication:'Stale title',logo_url:logo}}).catch(()=>{});await page.waitForTimeout(100);
  assert.equal(await mast.textContent(),'Newer title');
  mode='failure';await input.fill('outage.substack.com');await page.waitForTimeout(850);assert.equal(await mast.textContent(),'outage');assert.equal(await page.locator('.press-specimen img[src]').count(),0);assert.equal(await page.locator('#trybtn').isEnabled(),true);
  assert.equal(requests.filter(r=>r.method!=='GET'&&!['/api/event'].includes(r.path)).length,0,'typing never reserves or sends feedback');
  check(!errors.length,errors.join('; '));results.push({engine,width,requests:requests.filter(r=>r.path==='/api/publication').length,pass:true});console.log('PASS interactions',engine,width);await page.close();
 }}finally{await browser.close()}
}
await writeFile(`${out}/results.json`,JSON.stringify({fitCount,cases:results,failures},null,2)+'\n');
console.log(`${fitCount} cover-fit checks; ${failures.length} failures`);if(failures.length){console.error(failures.slice(0,30).join('\n'));process.exitCode=1;}
