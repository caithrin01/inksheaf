import {chromium,webkit} from 'playwright';
import {coverMarkup,coverStyle} from '../functions/lib/book-design.js';
import {writeFile,mkdir} from 'node:fs/promises';
const out='output/site-integration';await mkdir(out,{recursive:true});const rows=[];
const titles=['The Fox Says','Letters about the changing shape of work, technology, and everything we build together across the years and generations','APublicationWithASingleUnusuallyLongNameAndNoSpacesAtAll','关于生活科技与我们共同建设的世界'.repeat(7),'رسائل عن الحياة والتكنولوجيا والعالم الذي نبنيه معًا'];
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:8840/');
  for(const width of [160,350,576])for(const design of ['masthead','classic','field','midnight'])for(const title of titles)for(const logo of ['none','transparent','band']){
   const content=coverMarkup({publication:title,kind:'Collected essays · 2025–26',dates:'July 2025 – June 2026',foot:'22 essays · 6 × 9 · perfect bound',logo:logo==='none'?'':logo==='band'?'/book/example-caithrin-logo.png':'/book/caithrin-mark-charcoal.svg',logoTreatment:logo});
   await page.setContent(`<link rel="stylesheet" href="/fonts/site.css"><link rel="stylesheet" href="/book/cover.css"><div class="cover-face" data-design="${design}" style="width:${width}px;${coverStyle(design,{},title)}">${content}</div>`);
   await page.evaluate(()=>document.fonts.ready);
   const bad=await page.locator('.edition-cover').evaluate(el=>{
    const b=el.getBoundingClientRect();return [...el.querySelectorAll(':scope>*,.cv-logo-band>*')].filter(e=>e.getBoundingClientRect().width>0&&getComputedStyle(e).display!=='none').filter(e=>{const r=e.getBoundingClientRect();return r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1}).map(e=>e.className);
   });
   if(bad.length){await page.screenshot({path:`${out}/cover-fit-failure.png`});throw Error(JSON.stringify({engine,width,design,title,logo,bad}));}
   rows.push({engine,width,design,title,logo,pass:true});
  }
 }finally{await browser.close()}
 console.log('PASS',engine,'180 cover/title/logo/size combinations');
}
await writeFile(`${out}/cover-fit.json`,JSON.stringify(rows,null,2));
