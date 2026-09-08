import {chromium,webkit} from 'playwright';import {mkdirSync,writeFileSync} from 'node:fs';
const out='output/playwright/integrated';mkdirSync(out,{recursive:true});
const evidence=[];
for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();
 try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:width===390?844:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8809/');await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(700);await page.screenshot({path:`${out}/${name}-${width}-hero.png`});
 await page.locator('#tryurl').fill('caithrin.com');await page.locator('#trybtn').click();await page.waitForFunction(()=>document.querySelector('#preview').classList.contains('personalized'));await page.waitForTimeout(3300);
 await page.screenshot({path:`${out}/${name}-${width}-cover.png`});
 await page.locator('#view-sample').click();await page.waitForFunction(()=>document.querySelector('#sample-position').textContent.length>0,{timeout:20000});
 await page.screenshot({path:`${out}/${name}-${width}-sample.png`});
 const pages=await page.locator('#sample-position').textContent();
 if(await page.locator('#sample-next').isEnabled()){await page.locator('#sample-next').click();await page.screenshot({path:`${out}/${name}-${width}-sample-2.png`});}
 await page.locator('#view-cover').click();
 for(const design of ['classic','field','midnight','masthead']){
 await page.locator(`[data-cover=${design}]`).click();await page.screenshot({path:`${out}/${name}-${width}-${design}.png`});
 await page.locator('#pv-cta').click();const selection=JSON.parse(await page.locator('#plan_json').inputValue());if(selection.design?.cover!==design)throw new Error('Design lost from reservation');
 await page.locator('#preview').scrollIntoViewIfNeeded();
 }
 if(errors.length)throw new Error(errors.join(';'));
 evidence.push({name,width,pages,reservation_designs:true});console.log('PASS',name,width,pages);await page.close();
 }}finally{await browser.close();}
}
writeFileSync(`${out}/results.json`,JSON.stringify(evidence,null,2));
