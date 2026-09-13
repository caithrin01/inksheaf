// Complete volumes rendered by real PDF.js in Chromium/WebKit. Synthetic source
// text and intercepted local APIs; no inference, storage, mail or publication.
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const base=process.argv[2];assert(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const out='output/playwright/launch/complete-reader';await mkdir(out,{recursive:true});
const books=[];
for(const [i,total] of [18,10].entries()){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.TimesRoman);
 const pages=[];
 for(let n=1;n<=total;n++){
  const label=n===2?'Contents':n>=4?`Page ${n-3}`:`Leaf ${n}`;
  doc.addPage([432,648]).drawText(`Volume ${i+1}, physical leaf ${n}.\nThe original words on this finished page.\n${label}`,{x:40,y:530,size:16,font,lineHeight:24});pages.push({number:n,label,text_mode:'prose'});
 }
 const bytes=Buffer.from(await doc.save());books.push({bytes,sha256:createHash('sha256').update(bytes).digest('hex'),pages});
}
const axe=await readFile('node_modules/axe-core/axe.min.js','utf8'),results=[];
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1,reducedMotion:'reduce'}),errors=[],external=[];
  let failed=false,wrongBytes=false,revision=0,fetches=0,holdDownload=null,unavailable=false,mailAccepted=false;
  page.on('pageerror',e=>errors.push(e.message));
  const readers=()=>books.map((b,i)=>({volume:String(i+1),label:`Volume ${i+1}`,complete:true,round:0,sequence:3,version_id:8,selection_revision:0,sha256:b.sha256,pages:b.pages,total_pages:b.pages.length,expires_at:4000000000000,url:`/api/edition-file?id=41&sig=fixture&run=fixture.1&sequence=3&version=8&volume=${i+1}`}));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==new URL(base).origin){external.push(u.origin);return route.abort();}
   if(u.pathname==='/api/edition-file'){
    fetches++;if(!failed){failed=true;return route.fulfill({status:503,json:{ok:false}});}
    if(holdDownload)await holdDownload;
    return route.fulfill({contentType:'application/pdf',body:wrongBytes?books[1].bytes:books[Number(u.searchParams.get('volume'))-1].bytes});
   }
   if(u.pathname==='/api/edition')return route.fulfill({json:{ok:true,id:41,publication_url:'https://fixture.substack.com',email:'fixture@example.com',status:'proofed',run_id:'fixture.1',selection:{revision,restored:[]},events:[{kind:'identity',sequence:1,publication:'The things we keep',contributors:['A synthetic browser fixture']},{kind:'ready',sequence:3,version_id:8,selection_revision:0,pages:28,unavailable,reader:unavailable?[]:readers(),files:(unavailable?[]:readers()).map(r=>({label:r.label,pages:r.total_pages,url:r.url+'&download=1'})),expires_at:'2096-10-02T07:06:40Z'}],email_status:mailAccepted?'accepted':'queued'}});
   if(u.pathname.startsWith('/api/'))throw Error('Unexpected action '+u.pathname);
   return route.continue();
  });
  const settled=()=>page.waitForFunction(()=>document.getElementById('draft-surface').getAttribute('aria-busy')==='false');
  const text=()=>page.locator('#draft-prose').innerText();
  await page.goto(new URL('/edition?id=41&sig=fixture',base).href);
  await page.getByRole('button',{name:'Read your book',exact:true}).waitFor();assert.equal(fetches,0);
  await page.getByRole('button',{name:'Read your book',exact:true}).click();await page.getByRole('button',{name:'Try these pages again'}).waitFor();
  await page.getByRole('button',{name:'Try these pages again'}).click();await page.locator('#draft-paper canvas').waitFor();await settled();
  assert.match(await page.locator('#draft-position').innerText(),/Leaf 1.*Leaf 1 of 18/s);
  await page.getByLabel('Go to page').selectOption('9');await settled();assert.match(await text(),/Volume 1, physical leaf 10/);assert.match(await page.locator('#draft-position').innerText(),/Page 7.*Leaf 10 of 18/s);
  const ink=await page.locator('#draft-paper canvas').evaluate(canvas=>{const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let dark=0;for(let i=0;i<p.length;i+=4)if(p[i]<180&&p[i+3])dark++;return {dark,pixels:canvas.width*canvas.height,width:canvas.width,height:canvas.height,deviceScale:devicePixelRatio};});
  assert(ink.dark/ink.pixels>0.001,`Expected visible PDF ink at every device scale: ${JSON.stringify(ink)}`);
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:`${out}/${engine}-${width}-middle.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Read as text',exact:true}).click();await settled();
  await page.getByLabel('Go to page').selectOption('17');await settled();assert.match(await text(),/Volume 1, physical leaf 18/);assert.equal(await page.getByRole('button',{name:'Next page',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Previous page',exact:true}).focus();await page.keyboard.press('Enter');await settled();assert.match(await text(),/physical leaf 17/);
  await page.getByLabel('Volume',{exact:true}).selectOption('2');await settled();await page.getByLabel('Go to page').selectOption('9');await settled();assert.match(await text(),/Volume 2, physical leaf 10/);assert.match(await page.locator('#draft-position').innerText(),/Page 7.*Leaf 10 of 10/s);
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:`${out}/${engine}-${width}-last-text.png`,fullPage:true,animations:'disabled'});
  await page.addScriptTag({content:axe});assert.deepEqual(await page.evaluate(async()=>(await window.axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>v.id)),[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const id of ['draft-volume','draft-jump'])assert((await page.locator('#'+id).boundingBox()).height>=44);
  assert.equal(await page.locator('#download-links a').count(),2);
  assert((await page.locator('#download-links a').all()).length===2);
  // Switching volumes discards old bytes. A wrong PDF must not paint or expose text.
  wrongBytes=true;await page.getByLabel('Volume',{exact:true}).selectOption('1');await settled();assert.equal(await page.locator('#draft-paper canvas').count(),0);assert.equal(await text(),'');await page.getByRole('button',{name:'Try these pages again'}).waitFor();
  wrongBytes=false;await page.getByRole('button',{name:'Try these pages again'}).click();await settled();assert.match(await text(),/Volume 1/);
  // An ordinary reload reconstructs all finished volumes, with no action endpoint.
  await page.reload();await page.getByRole('button',{name:'Read your book',exact:true}).click();await page.locator('#draft-paper canvas').waitFor();await settled();await page.getByLabel('Go to page').selectOption('17');await settled();assert.match(await text(),/physical leaf 18/);
  // A returning tab revalidates even after delivery; a superseded version clears cached pages.
  mailAccepted=true;unavailable=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(()=>document.getElementById('show-pages').disabled);assert.equal(await page.locator('#draft-paper canvas').count(),0);assert.equal(await page.locator('#edition-downloads').isVisible(),false);
  unavailable=false;await page.reload();await page.getByRole('button',{name:'Read your book',exact:true}).click();await page.locator('#draft-paper canvas').waitFor();await settled();
  // A correction while the next volume is in flight clears labels and bytes.
  let release;holdDownload=new Promise(r=>{release=r;});await page.getByLabel('Volume',{exact:true}).selectOption('2');revision=1;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(()=>document.getElementById('show-pages').disabled,{},{timeout:10000});release();holdDownload=null;await settled();assert.equal(await page.locator('#draft-paper canvas').count(),0);assert.equal(await text(),'');assert.equal(await page.locator('#edition-downloads').isVisible(),false);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  results.push({engine,width,pass:true,ink,volumes:books.map(b=>({pages:b.pages.length,sha256:b.sha256})),states:['complete without draft','load retry','arbitrary middle','last page each volume','printed labels','keyboard','text view','wrong digest refusal','reload','superseded version on return after delivery','revision during transfer'],limits:'Synthetic PDFs and intercepted APIs, not real creator/inbox acceptance.'});
  console.log('PASS complete reader',engine,width);await page.close();
 }}finally{await browser.close();}
}
await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');
