import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {coverMarkup,coverStyle} from '../../functions/lib/book-design.js';
import {coverLogo} from '../../functions/lib/cover-logo.js';
const out='output/playwright/site-design';await mkdir(out,{recursive:true});
const example={host:'caithrin.com',publication:'caithrin',logo_url:'/book/example-caithrin-logo.png',theme:{cover_bg:'#1d1e1d',cover_ink:'#ffffff'},kind:'Collected essays',dates:'2025 — 2026',foot:'caithrin.com'};
const book=design=>`<div class="book ${design}"><div class="cover-face" data-design="${design}" style="${coverStyle(design,example.theme,'caithrin')}">${coverMarkup({...example,...coverLogo(example,design)})}</div></div>`;
const social=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fonts/site.css"><link rel="stylesheet" href="/book/cover.css"><style>*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;background:#ededea;color:#181a19;font-family:Inter,Arial,sans-serif}.brand{position:absolute;left:55px;top:30px;width:380px;filter:invert(1)}header{height:127px;background:#181a19}h1{position:absolute;left:55px;top:217px;margin:0;font-size:72px;font-weight:500;letter-spacing:-.065em;line-height:1.02}.intro{position:absolute;left:58px;top:400px;font-size:24px;line-height:1.55;max-width:480px}.note{position:absolute;left:58px;bottom:34px;font-size:14px}.book{position:absolute;width:250px;height:375px;box-shadow:1px 2px 0 #e5e1d4,2px 3px 0 #b9b7ac,3px 5px 2px #181a192c,9px 14px 14px #181a191a}.book>.cover-face{width:100%;height:100%}.classic{top:170px;left:610px;transform:rotate(-7deg)}.masthead{top:214px;left:893px;transform:rotate(5deg)}</style></head><body><header><img class="brand" src="/brand/wordmark.svg" alt="inksheaf"></header><h1>Your Substack.<br>In print.</h1><p class="intro">Your writing, gathered into a paperback.<br>A print button for your readers.</p><p class="note">inksheaf.com · Private beta · US delivery</p>${book('classic')}${book('masthead')}</body></html>`;
await writeFile('design/social-card.html',social);
const browser=await chromium.launch();
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:8840/');await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`${out}/opening-${width}.png`});
  await page.screenshot({path:`${out}/full-${width}.png`,fullPage:true});
  for(const id of ['for-your-readers','cover-collection','inside','faq']){const box=await page.locator('#'+id).evaluate(e=>{const b=e.getBoundingClientRect();return {y:b.y+scrollY,height:b.height}});await page.screenshot({path:`${out}/${id}-${width}.png`,fullPage:true,clip:{x:0,y:box.y,width,height:box.height}});}
  for(const path of ['change','mail','404.html']){
   await page.goto('http://127.0.0.1:8840/'+path+(path.endsWith('.html')?'':'/'));
   await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:`${out}/${path.replace('.html','')}-${width}.png`});
  }
  await page.close();
 }
 const page=await browser.newPage({viewport:{width:1200,height:630}});
 await page.goto('http://127.0.0.1:8840/');await page.setContent(social);await page.evaluate(()=>document.fonts.ready);
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 await page.screenshot({path:'public/og.png'});await page.close();
}finally{await browser.close()}
console.log('Captured final landing, supporting pages and 1200×630 social image.');
