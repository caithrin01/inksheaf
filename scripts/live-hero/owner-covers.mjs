import{readFileSync,writeFileSync}from'node:fs';import{execFileSync}from'node:child_process';import{resolve}from'node:path';
import{chromium}from'playwright';import{PDFDocument}from'pdf-lib';import{designSelection}from'../../functions/lib/book-design.js';
const root='output/private-acceptance',dir=root+'/owner-order',identity=JSON.parse(readFileSync(root+'/caithrin.com/identity.json'));
const dimensions=JSON.parse(readFileSync(dir+'/lulu-dimensions.json')),W=+dimensions.width,H=+dimensions.height,results=[];
const browser=await chromium.launch();
try{const page=await browser.newPage({viewport:{width:1250,height:920}});
 await page.route(/^https?:/,r=>r.abort()); // Print fonts and owner marks must already be embedded.
 for(const cover of ['masthead','classic','field','midnight']){
  const design=designSelection(cover,identity.theme||{});writeFileSync(dir+`/design-${cover}.json`,JSON.stringify(design,null,2));
  const html=dir+`/cover-${cover}.html`,pdf=dir+`/cover-${cover}.pdf`;
  execFileSync('node',['scripts/cover-wrap.mjs',String(W),String(H),html,'--meta',dir+'/cover-meta.json','--brand',root+'/caithrin.com/brand.json','--design-file',dir+`/design-${cover}.json`],{stdio:'pipe'});
  await page.goto('file://'+resolve(html));await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth));
  await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});
  const doc=await PDFDocument.load(readFileSync(pdf)),size=doc.getPage(0).getSize();
  if(doc.getPageCount()!==1||Math.abs(size.width-W)>.2||Math.abs(size.height-H)>.2)throw Error('Wrong Lulu geometry');
  const fit=await page.locator('.panel.front .edition-cover').evaluate(el=>{const b=el.getBoundingClientRect();return [...el.children].filter(e=>getComputedStyle(e).display!=='none').every(e=>{const r=e.getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1})});
  if(!fit)throw Error(cover+' clips');
  await page.screenshot({path:dir+`/wrap-${cover}.png`,fullPage:true});
  results.push({cover,pages:1,size,interiorPages:dimensions.pages,pass:true});
 }
}finally{await browser.close()}
writeFileSync(dir+'/cover-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
