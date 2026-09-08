import{readFileSync,writeFileSync,mkdirSync,existsSync}from'node:fs';import{execFileSync}from'node:child_process';import{resolve}from'node:path';import{chromium}from'playwright';import{PDFDocument}from'pdf-lib';
import{designSelection}from'../../functions/lib/book-design.js';
import{classifyLogoPixels}from'../../functions/lib/cover-logo.js';
const root='output/private-acceptance',rows=JSON.parse(readFileSync(`${root}/fetch-results.json`));const browser=await chromium.launch(),results=[];
try{for(const row of rows){
 const dir=`${root}/${row.host}`,identity=JSON.parse(readFileSync(`${dir}/identity.json`));if(!identity.ok){results.push({host:row.host,error:'identity unresolved'});continue;}
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://127.0.0.1:8850/');
 let treatment={treatment:'original'};
 if(identity.logo_url){
  const pixels=await page.evaluate(url=>new Promise(resolve=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>{try{const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,64,64);resolve([...ctx.getImageData(0,0,64,64).data])}catch{resolve(null)}};image.onerror=()=>resolve(null);image.src=url;setTimeout(()=>resolve(null),8000)}),identity.logo_url);
  if(pixels)treatment=classifyLogoPixels(pixels,64,64);
 }
 writeFileSync(`${dir}/logo-treatment.json`,JSON.stringify(treatment,null,2));
 const brand={host:row.host,logo_url:identity.logo_url,cover_bg:identity.theme?.cover_bg,cover_print:identity.theme?.cover_ink};
 // No public route doesn't mean the logo/cover case disappears from the test.
 writeFileSync(`${dir}/cover-brand.json`,JSON.stringify(brand));
 writeFileSync(`${dir}/cover-meta.json`,JSON.stringify({pubName:identity.publication,host:row.host,kindLine:'Collected edition',spineText:identity.publication+' · Collected edition',dates:row.volume||'A cover study',countLine:row.selectedPosts?`${row.selectedPosts} pieces`:'Cover study',desc:'Private Inksheaf design and print test. Not a publication offered for sale.'}));
 for(const cover of ['masthead','classic','field','midnight']){
  const design=designSelection(cover,identity.theme||{},treatment);writeFileSync(`${dir}/design-${cover}.json`,JSON.stringify(design));
  const html=`${dir}/cover-${cover}.html`,pdf=`${dir}/cover-${cover}.pdf`;
  try{
   execFileSync('node',['scripts/cover-wrap.mjs','903','666',html,'--meta',`${dir}/cover-meta.json`,'--brand',`${dir}/cover-brand.json`,'--design-file',`${dir}/design-${cover}.json`],{stdio:'pipe',timeout:20000});
   await page.goto('file://'+resolve(html));await page.evaluate(()=>document.fonts.ready);
   const state=await page.locator('.panel.front .edition-cover').evaluate(el=>{const b=el.getBoundingClientRect(),mast=el.querySelector('.cv-mast'),node=mast.firstChild,brokenWords=[];for(const match of mast.textContent.matchAll(/[A-Za-zÀ-ÿ’']{2,24}/g)){const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);if(new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size>1)brokenWords.push(match[0]);}return{title:mast.textContent,brokenWords,bad:[...el.children].filter(e=>getComputedStyle(e).display!=='none').filter(e=>{const r=e.getBoundingClientRect();return r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1}).map(e=>e.className),logos:[...el.querySelectorAll('img:not([hidden])')].map(img=>({painted:img.complete&&img.naturalWidth>0,width:img.naturalWidth,height:img.naturalHeight}))}});
   if(state.brokenWords.length||state.bad.length||state.title!==identity.publication||state.logos.some(l=>!l.painted)||identity.logo_url&&!state.logos.length)throw Error(JSON.stringify(state));
   await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});const doc=await PDFDocument.load(readFileSync(pdf)),size=doc.getPage(0).getSize();if(doc.getPageCount()!==1||Math.abs(size.width-903)>1||Math.abs(size.height-666)>1)throw Error('Incorrect wrap dimensions');
   await page.locator('.panel.front').screenshot({path:`${dir}/cover-${cover}.png`});
   results.push({host:row.host,cover,publication:identity.publication,treatment,logos:state.logos,pages:1,geometry:size,pass:true});console.log('PASS cover',row.host,cover,treatment.treatment);
  }catch(e){results.push({host:row.host,cover,pass:false,error:String(e.stderr||e.message).slice(0,2000)});console.log('FAIL cover',row.host,cover,e.message.slice(0,100));}
  writeFileSync(`${root}/cover-results.json`,JSON.stringify(results,null,2));
 }
 await page.close();
}}finally{await browser.close()}
console.log(`${results.filter(r=>r.pass).length}/${results.length} print covers passed`);process.exitCode=results.some(r=>!r.pass)?1:0;
