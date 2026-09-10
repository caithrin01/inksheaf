// Actual PDF.js rendering on a local Typst fixture. All API effects intercepted.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base=process.argv[2];assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const out='output/playwright/launch/publisher-pages';await mkdir(out,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'publisher-pages-browser-')),file=join(dir,'pages.pdf');
execFileSync('typst',['compile','--font-path','fonts','scripts/fixtures/publisher-preview.typ',file]);
const bytes=await readFile(file),sha=createHash('sha256').update(bytes).digest('hex');
const axe=await readFile('node_modules/axe-core/axe.min.js','utf8'),results=[];
const pages=[{number:5,label:'Contents'},{number:9,label:'Page 1',text_mode:'prose'},{number:10,label:'Page 2',text_mode:'prose'}];
const snapshot={kind:'pages',sequence:3,selection_revision:0,volume:'1',round:0,draft:true,pages,total_pages:42,sha256:sha,url:'/api/edition-pages?id=41&sig=fixture&run=fixture.1&sequence=3'};
for(const [engine,browserType] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await browserType.launch();
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}),errors=[],external=[];let available=false,failOnce=true,revision=0,revised=false,fetches=0,finished=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==new URL(base).origin){external.push(u.origin);return route.abort();}
   if(u.pathname==='/api/edition-pages'){fetches++;if(failOnce){failOnce=false;return route.fulfill({status:503,json:{ok:false}});}return route.fulfill({contentType:'application/pdf',body:bytes});}
   if(u.pathname==='/api/edition')return route.fulfill({json:{ok:true,id:41,publication_url:'https://fixture.substack.com',email:'fixture@example.com',status:finished?'proofed':'building',run_id:revised?'fixture.1.s1':'fixture.1',design:{cover:'classic'},selection:{revision,restored:revision?['saved-piece']:[]},events:[{kind:'identity',sequence:1,selection_revision:revised?1:0,publication:'The things we keep',contributors:['A synthetic browser fixture']},{kind:'typesetting',sequence:2,selection_revision:revised?1:0,message:'Your writing and images have been set on the page.'},...(available?[{...snapshot,selection_revision:revised?1:0,round:revised?1:0,url:snapshot.url.replace('fixture.1',revised?'fixture.1.s1':'fixture.1')}]:[]),...(finished?[{kind:'ready',sequence:4,pages:42,expires_at:'2030-01-01T00:00:00Z',files:[]}]:[])],email_status:finished?'accepted':null}});
   if(u.pathname.startsWith('/api/'))throw Error('Unexpected API action '+u.pathname);
   return route.continue();
  });
  await page.goto(new URL('/edition?id=41&sig=fixture',base).href);
  await page.waitForFunction(()=>document.getElementById('edition-cover').textContent.includes('The things we keep'));
  assert.equal(await page.getByRole('button',{name:'Pages',exact:true}).isDisabled(),true);assert.equal(fetches,0);
  available=true;await page.getByRole('button',{name:'Read the first pages'}).waitFor({timeout:10000});
  // Discovering available pages does not load a decoder or PDF before reading.
  assert.equal(fetches,0);await page.getByRole('button',{name:'Read the first pages'}).click();
  await page.getByRole('button',{name:'Try these pages again'}).waitFor();
  assert.equal(await page.locator('#draft-surface').getAttribute('aria-busy'),'false');
  await page.getByRole('button',{name:'Try these pages again'}).click();await page.locator('#draft-paper canvas').waitFor();
  await page.waitForFunction(()=>document.getElementById('draft-surface').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#draft-paper canvas').getAttribute('role'),'img');
  assert.match(await page.locator('#draft-position').textContent(),/Page 1.*Preview 2 of 3/);
  await page.getByRole('button',{name:'Previous preview page'}).click();await page.waitForFunction(()=>document.getElementById('draft-position').textContent.includes('Contents'));
  await page.waitForFunction(()=>document.getElementById('draft-surface').getAttribute('aria-busy')==='false');
  await page.getByRole('button',{name:'Next preview page'}).focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.getElementById('draft-prose').textContent.includes('The table was the first thing'));
  await page.waitForFunction(()=>document.getElementById('draft-surface').getAttribute('aria-busy')==='false');
  assert.match(await page.locator('#draft-position').textContent(),/Page 1.*Preview 2 of 3/);
  // Prove the PDF actually painted non-white pixels; a blank canvas is no pass.
  assert(await page.locator('#draft-paper canvas').evaluate(canvas=>{const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<180&&pixels[i+3]>0)dark++;return dark>1000;}));
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:`${out}/${engine}-${width}-print.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Read as text',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('draft-prose').hidden&&document.getElementById('draft-surface').getAttribute('aria-busy')==='false');
  assert.match(await page.locator('#draft-prose').innerText(),/The table was the first thing/);assert((await page.locator('#draft-prose p').count())>=5);assert.equal(await page.locator('#draft-paper').isVisible(),false);
  if(width===390){assert.equal(await page.locator('#continuity-reading #edition-continuity').count(),1);assert((await page.locator('#edition-cover').boundingBox()).height<=181);}
  assert.equal(await page.getByRole('button',{name:'Read as text',exact:true}).getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:`${out}/${engine}-${width}-text.png`,fullPage:true,animations:'disabled'});
  await page.addScriptTag({content:axe});assert.deepEqual(await page.evaluate(async()=>(await window.axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>v.id)),[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'Next preview page'}).click();await page.waitForFunction(()=>document.getElementById('draft-prose').textContent.includes('Some things ask'));
  assert.equal(await page.getByRole('button',{name:'Next preview page'}).isDisabled(),true);
  await page.getByRole('button',{name:'Printed page',exact:true}).click();await page.locator('#draft-paper canvas').waitFor();
  // A saved correction removes the old draft and stops it being reopened.
  revision=1;await page.waitForFunction(()=>document.getElementById('show-pages').disabled);
  assert.equal(await page.locator('#draft-paper canvas').count(),0);assert.equal(await page.locator('#draft-prose').textContent(),'');
  revised=true;await page.getByRole('button',{name:'Read the first pages'}).waitFor();await page.getByRole('button',{name:'Pages',exact:true}).click();await page.locator('#draft-paper canvas').waitFor();
  assert.match(await page.locator('#draft-status').textContent(),/latest layout adjustments/);
  // Reload reconstructs the private artifact; no generation/email/listing call.
  await page.reload();await page.getByRole('button',{name:'Read the first pages'}).waitFor();await page.getByRole('button',{name:'Pages',exact:true}).click();await page.locator('#draft-paper canvas').waitFor();
  finished=true;await page.waitForFunction(()=>document.querySelector('.pages-intro').textContent.includes('finished edition'));
  assert.match(await page.locator('#draft-status').textContent(),/earlier preview pages/);
  assert.equal(await page.getByRole('button',{name:'Pages',exact:true}).getAttribute('aria-pressed'),'true');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  results.push({engine,width,pass:true,pdf_sha256:sha,states:['unavailable','load failure and retry','actual print pixels','page turn by keyboard','read as text','restored choice retires draft','revised pages','reload'],fixture:'Synthetic Typst PDF; API snapshots intercepted; no paid model, upload, email or public URL'});
  console.log('PASS private page reader',engine,width);await page.close();
 }}finally{await browser.close();}
}
await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');
