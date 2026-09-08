import{chromium,webkit}from'playwright';import{readFileSync,writeFileSync,mkdirSync}from'node:fs';
const root='output/private-acceptance',rows=JSON.parse(readFileSync(root+'/fetch-results.json')).filter(r=>r.host!=='caithrin.com'),results=[];
for(const[engine,type]of[['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();
 try{for(const row of rows){
  const context=await browser.newContext({viewport:{width:engine==='webkit'?390:1440,height:900},serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await context.route('**/api/**',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.fulfill({json:{ok:true}}));
  const out=`${root}/${row.host}/browser-${engine}`;mkdirSync(out,{recursive:true});const result={host:row.host,engine};
  try{
   await page.goto('http://127.0.0.1:8852/?pub='+encodeURIComponent(row.host));
   await page.waitForFunction(()=>!document.querySelector('#trybtn').disabled,null,{timeout:90000});
   if(!row.selectedPosts){
    const error=await page.locator('#tryerr').textContent();if(!/no public essays/i.test(error))throw Error(error||'No negative-path explanation');result.status='no public sample expected';
   }else{
    await page.locator('#view-sample').click();const frame=page.frameLocator('#sample-frame');
    await frame.locator('#reading .artbody p').first().waitFor({state:'visible',timeout:30000});
    await page.waitForFunction(()=>document.querySelector('#sample-status').textContent==='',null,{timeout:5000});
    const text=await frame.locator('#reading').innerText();if(text.length<100)throw Error('Sample contains too little readable text');
    const loading=await frame.locator('#status').textContent();if(loading)throw Error('Stale inner loading status: '+loading);
    result.characters=text.length;result.source=await page.locator('#sample-source').getAttribute('href');result.status='readable excerpt; loading status cleared';
   }
   if(errors.length)throw Error(errors.join('; '));result.pass=true;
  }catch(e){result.pass=false;result.error=e.message;result.status=await page.locator('#sample-status').textContent().catch(()=>null);}
  await page.screenshot({path:`${out}/sample${result.pass?'':'-failed'}.png`}).catch(()=>{});
  results.push(result);writeFileSync(root+'/sample-results.json',JSON.stringify(results,null,2));console.log(result.pass?'PASS':'FAIL',engine,row.host,result.status||result.error);await context.close();
 }}finally{await browser.close()}
}
console.log(`${results.filter(r=>r.pass).length}/${results.length} sample journeys passed`);process.exitCode=results.some(r=>!r.pass)?1:0;
