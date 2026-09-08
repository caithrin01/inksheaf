import {chromium,webkit} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {edited} from './fixtures/preview-editor-exclusion.mjs';
const base=process.argv[2]||'http://127.0.0.1:8840/';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local only');
const out='output/playwright/site-design';await mkdir(out,{recursive:true});
const identity=JSON.parse(await readFile('scripts/fixtures/publication-caithrin.json','utf8'));
const sample=JSON.parse(await readFile('scripts/fixtures/public-sample-caithrin.json','utf8'));
const axe=await readFile('node_modules/axe-core/axe.min.js','utf8');const results=[];
const assert=(yes,msg)=>{if(!yes)throw Error(msg)};
function contrast(a,b){const lum=c=>c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();
 try{for(const width of [1440,390])for(const scheme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000},colorScheme:scheme,reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>{const p=new URL(r.request().url()).pathname;return r.fulfill({json:p==='/api/preview'?{...edited,logo_url:identity.logo_url,theme:identity.theme}:p==='/api/sample'?sample:{ok:true,press:'test'}})});
  await page.goto(base);await page.evaluate(()=>document.fonts.ready);await page.locator('#tryurl').fill('caithrin.com');
  const input=await page.locator('#tryurl').evaluate(e=>{const s=getComputedStyle(e),p=getComputedStyle(e,'::placeholder'),r=e.getBoundingClientRect();return{ink:s.webkitTextFillColor,paper:s.backgroundColor,placeholder:p.webkitTextFillColor,font:parseFloat(s.fontSize),align:s.textAlign,top:r.top,bottom:r.bottom}});
  assert(contrast(input.ink,input.paper)>=7,`${engine} ${width} ${scheme}: input text contrast`);assert(contrast(input.placeholder,input.paper)>=4.5,'placeholder contrast');assert(input.font>=18&&input.align==='left','input type size/alignment '+JSON.stringify(input));assert(input.bottom<844,'input below mobile fold');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'hero overflow');
  if(engine==='chromium'){
    await page.screenshot({path:`${out}/hero-${width}-${scheme}.png`});
    if(scheme==='light'){
      await page.screenshot({path:`${out}/full-${width}.png`,fullPage:true});
      for(const id of ['for-your-readers','cover-collection','inside','faq'])await page.locator('#'+id).screenshot({path:`${out}/${id}-${width}.png`});
    }
  }
  await page.locator('#trybtn').click();await page.waitForFunction(()=>document.querySelector('#preview').classList.contains('personalized'));
  await page.locator('#preview').scrollIntoViewIfNeeded();
  for(const design of ['masthead','classic','field','midnight']){
   await page.locator(`[data-cover=${design}]`).click();
   assert(await page.locator('#pv-mast').textContent()==='caithrin','publication identity');
   const fit=await page.locator('#pvbook .edition-cover').evaluate(el=>{const b=el.getBoundingClientRect();return [...el.children].filter(e=>getComputedStyle(e).display!=='none').every(e=>{const r=e.getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1})});assert(fit,`${design} cover overflow`);
   if(engine==='chromium'&&scheme==='light'&&(width===1440||design==='masthead')){await page.locator('#preview').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-24));await page.screenshot({path:`${out}/${design}-${width}.png`});}
  }
  await page.locator('#view-sample').click();await page.waitForFunction(()=>document.querySelector('#sample-position').textContent==='Text excerpt');
  const frame=page.frames().find(f=>f.url().includes('/reader/'));await frame.locator('#reading .artbody p').first().waitFor();await page.waitForFunction(()=>!document.querySelector('#sample-mode').disabled);
  assert((await frame.locator('#reading').innerText()).includes('On the surface'),'readable sample missing real prose');assert(await frame.locator('#reading').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=18),'screen reading text is too small');assert(await frame.locator('#reading .artbody p').first().evaluate(el=>{const s=getComputedStyle(el);return s.textAlign==='left'&&parseFloat(s.textIndent)===0}),'print paragraph spacing leaked into reading view');
  if(engine==='chromium'&&scheme==='light'){await page.locator('#preview').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-24));await page.screenshot({path:`${out}/sample-${width}.png`});}
  await page.addScriptTag({content:axe});const violations=await page.evaluate(async()=>{const r=await window.axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});assert(!violations.length,JSON.stringify(violations));assert(!errors.length,errors.join(';'));
  results.push({engine,width,scheme,inputContrast:contrast(input.ink,input.paper),placeholderContrast:contrast(input.placeholder,input.paper),readerFont:18,axe:0,pass:true});console.log('PASS',engine,width,scheme);await page.close();
 }}finally{await browser.close()}
}
await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
