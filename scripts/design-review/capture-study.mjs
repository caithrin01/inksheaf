import { chromium, webkit } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:8808/design-study/';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Local study required');
const out='output/playwright/topdown-study';mkdirSync(out,{recursive:true});
const axe=readFileSync('node_modules/axe-core/axe.min.js','utf8');
const rows=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch();
 try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#article-body').textContent.length>20);await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>{const l=document.querySelector('#publication-mark');return l.complete&&l.naturalWidth>0;});
  const check=await page.evaluate(()=>{
   const b=document.querySelector('.book').getBoundingClientRect(),form=document.querySelector('form').getBoundingClientRect();
   return {ratio:b.width/b.height,overflow:document.documentElement.scrollWidth>innerWidth,formVisible:form.bottom<=innerHeight};
  });
  if(Math.abs(check.ratio-2/3)>.001||check.overflow||!check.formVisible)throw new Error(JSON.stringify(check));
  // Axe cannot sample a photographic background. Hide the type, then measure its
  // actual background pixels with the original foreground colour at every location.
  const targets='.eyebrow,.promise,header .back,.caption,.design-copy,.design-options legend';
  // Text ranges exclude decorative borders and padding, which aren't behind glyphs.
  const regions=await page.locator(targets).evaluateAll(els=>els.map(el=>{const range=document.createRange();range.selectNodeContents(el);const r=range.getBoundingClientRect();return{x:r.x+scrollX,y:r.y+scrollY,w:r.width,h:r.height,color:getComputedStyle(el).color,text:el.textContent.slice(0,50)};}));
  const mask=await page.addStyleTag({content:`${targets},.caption a{color:transparent!important;text-shadow:none!important}`});
  const background=await page.screenshot({fullPage:true});await mask.evaluate(el=>el.remove());
  const photoContrast=await page.evaluate(async({encoded,regions})=>{
   const img=new Image();img.src='data:image/png;base64,'+encoded;await img.decode();
   const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
   const lum=rgb=>{const v=rgb.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
   return regions.map(r=>{const foreground=lum(r.color.match(/[\d.]+/g).slice(0,3).map(Number));const data=ctx.getImageData(Math.ceil(r.x),Math.ceil(r.y),Math.floor(r.w),Math.floor(r.h)).data;let minimum=Infinity;for(let i=0;i<data.length;i+=4){const bg=lum([data[i],data[i+1],data[i+2]]);minimum=Math.min(minimum,(Math.max(foreground,bg)+.05)/(Math.min(foreground,bg)+.05));}return{text:r.text,minimum};});
  },{encoded:background.toString('base64'),regions});
  if(photoContrast.some(r=>r.minimum<4.5))throw new Error(`Photographic contrast: ${JSON.stringify(photoContrast)}`);
  for(const design of ['classic','field','midnight','masthead']){
   await page.locator(`button[data-design="${design}"]`).click();
   await page.evaluate(()=>scrollTo(0,0));
   await page.screenshot({path:`${out}/${engine.name()}-${width}-${design}.png`,fullPage:width===390});
  }
  await page.locator('#view-sample').focus();await page.keyboard.press('Enter');
  if(await page.locator('#sample-page').getAttribute('aria-hidden')!=='false')throw new Error('Keyboard sample action failed');
  for(let i=0;i<3;i++){
   if(i)await page.locator('#next').click();
   for(const design of ['classic','field','midnight','masthead']){
    await page.locator(`button[data-design="${design}"]`).click();
    const fits=await page.evaluate(()=>{const b=document.querySelector('#article-body').getBoundingClientRect(),n=document.querySelector('.book').getBoundingClientRect();return b.bottom<n.bottom-18;});
    if(!fits)throw new Error(`${engine.name()} ${width} ${design} excerpt ${i+1} overflows the page`);
   }
   await page.locator('#study-book').scrollIntoViewIfNeeded();
   await page.screenshot({path:`${out}/${engine.name()}-${width}-excerpt-${i+1}.png`});
  }
  await page.addScriptTag({content:axe});const a=await page.evaluate(()=>window.axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
  if(a.violations.length)throw new Error(a.violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target).join(',')}`).join('; '));
  if(errors.length)throw new Error(errors.join('; '));
  rows.push({browser:engine.name(),width,...check,photoContrast,pass:true});console.log(`PASS ${engine.name()} ${width}: geometry, input, four covers, three excerpts, keyboard, axe and photo contrast`);
  await page.close();
 }
 }finally{await browser.close();}
}
writeFileSync(`${out}/results.json`,JSON.stringify({study:true,production:false,rows},null,2));
