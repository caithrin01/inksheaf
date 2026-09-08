import {chromium,webkit} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.argv[2]||'http://127.0.0.1:8840/';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Local review only');
const out='output/playwright/site-workflows';await mkdir(out,{recursive:true});
const axe=await readFile('node_modules/axe-core/axe.min.js','utf8'),results=[];
const fixture={ok:true,publication_url:'https://caithrin.com',status:'proof ready',plan:{cadence:'single',interior:'bw',volumes:[{label:'Collected essays',title:'Collected essays',post_ids:[1,2],est_pages:160}]},titles:{1:{title:'A place to begin',date:'2026-01-01'},2:{title:'A second letter',date:'2026-02-01'}},left_out:[]};
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();
 try{for(const width of [1280,390])for(const scheme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:scheme});const errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>{
   const req=r.request(),path=new URL(req.url()).pathname;
   if(req.method()==='POST')writes.push({path,body:req.postDataJSON()});
   return r.fulfill({json:path==='/api/change'?(req.method()==='GET'?fixture:{ok:true,plan:fixture.plan,reproof:'started'}):path==='/api/mail-context'?{ok:true,publication_url:'https://caithrin.com',interior:'bw',volumes:[{label:'Collected essays',pages:160}]}:path==='/api/quote'?{ok:true,payment:'invoice',level:'MAIL',quotes:[{ok:true,address:{name:'Review Reader',city:'Boston',state_code:'MA'},quantity:1,total:12}],totals:{print:7,shipping:5,tax:0,total:12,copies:1,estimated:true}}:{ok:true}});
  });
  async function check(name){
   await page.evaluate(()=>document.fonts.ready);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' page overflow');
   await page.addScriptTag({content:axe});
   const violations=await page.evaluate(async()=>{const r=await window.axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});
   assert.deepEqual(violations,[],name+' accessibility');
   assert.deepEqual(errors,[],name+' script errors');
   if(engine==='chromium')await page.screenshot({path:`${out}/${name}-${width}-${scheme}.png`,fullPage:true});
  }
  await page.goto(base+'change/?id=local-review&sig=simulated');await page.locator('#work').waitFor();
  await page.getByRole('textbox',{name:'Volume title'}).fill('My collected essays');
  await page.locator('input[name=keep]').last().uncheck();
  await page.getByLabel('Dedication',{exact:true}).fill('For our readers');
  await check('change');await page.getByRole('button',{name:'Apply and send a new proof'}).click();
  await page.locator('#done').waitFor();
  assert.equal(writes[0].body.changes.titles['Collected essays'],'My collected essays');
  assert.deepEqual(writes[0].body.changes.exclude,[2]);
  await page.goto(base+'mail/?id=local-review&sig=simulated');await page.locator('#work').waitFor();
  for(const [name,value] of [['Recipient name','Review Reader'],['Street address','12 Example St'],['City','Boston'],['State','MA'],['ZIP code','02108']])await page.getByRole('textbox',{name,exact:true}).fill(value);
  await page.getByRole('button',{name:'Price it',exact:true}).click();await page.locator('#invoice').waitFor();
  assert.match(await page.locator('#invoice').innerText(),/\$12\.00/);
  await check('mail');await page.getByRole('button',{name:'Send me the invoice',exact:true}).click();await page.locator('#done').waitFor();
  assert.equal(writes.at(-1).path,'/api/mail');assert.equal(writes.at(-1).body.addresses[0].postcode,'02108');
  results.push({engine,width,scheme,pass:true,axe:0,simulatedWrites:writes.length});console.log('PASS workflow',engine,width,scheme);await page.close();
 }}finally{await browser.close()}
}
await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');
