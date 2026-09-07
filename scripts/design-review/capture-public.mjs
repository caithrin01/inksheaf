// Read real public archives on the local, memory-only server; all outgoing actions are simulated.
import{chromium}from'playwright';import{mkdirSync,writeFileSync}from'node:fs';
const out='output/playwright/public-integration';mkdirSync(out,{recursive:true});const b=await chromium.launch();const rows=[];
try{for(const [host,name,width] of [['caithrin.com','caithrin',390],['manifund.substack.com','The Fox Says',1280]]){
 const p=await b.newPage({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:8810/');await p.screenshot({path:`${out}/${width}-hero.png`});
 await p.locator('#tryurl').fill(host);await p.locator('#trybtn').click();await p.waitForFunction(()=>document.querySelector('#preview').classList.contains('personalized'),null,{timeout:45000});
 await p.locator('#pv-logo').waitFor({state:'visible'});if(await p.locator('#pv-mast').textContent()!==name)throw Error('Wrong name');
 await p.screenshot({path:`${out}/${width}-cover.png`});await p.locator('#view-sample').click();await p.waitForFunction(()=>document.querySelector('#sample-position').textContent.length>0,null,{timeout:20000});
 await p.screenshot({path:`${out}/${width}-sample.png`});const source=await p.locator('#sample-source').getAttribute('href'),count=await p.locator('#sample-position').textContent();
 await p.locator('#sample-enlarge').click();await p.locator('#sample-scale').click();await p.screenshot({path:`${out}/${width}-actual-size.png`});await p.keyboard.press('Escape');
 if(errors.length)throw Error(errors.join(';'));rows.push({host,publication:name,source,pages:count,real_public_reads:true,production_writes:false});console.log('PASS',name,source);await p.close();
}}finally{await b.close();}
writeFileSync(`${out}/results.json`,JSON.stringify(rows,null,2));
