// The free publisher journey replaced the old verification-first signup. Network
// writes are intercepted; editorial events are from the saved synthetic live pilot.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {calendar} from './fixtures/preview-editor-exclusion.mjs';
import {confirmationPage} from '../functions/lib/verification.js';
const base=process.argv[2];assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const out='output/playwright/launch/publisher';await mkdir(out,{recursive:true});
const recorded=JSON.parse(await readFile('scripts/fixtures/publisher-events.json','utf8'));
const axe=await readFile('node_modules/axe-core/axe.min.js','utf8'),results=[];
for(const [engine,browserType] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await browserType.launch();
  try{for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:1000}});const errors=[],requests=[];let ready=false,emailAccepted=false,restored=false,applied=false,restoreFailure=true;
    page.on('pageerror',e=>errors.push(e.message));
    const events=recorded.map(e=>({...e,volume:'1',...(e.kind==='identity'?{publication:"Don't worry about the vase — letters on art, life, and the things we keep"}:{} )}));
    await page.route('**/api/**',async route=>{
      const r=route.request(),path=new URL(r.url()).pathname;requests.push(path);
      if(path==='/api/preview')return route.fulfill({json:calendar});
      if(path==='/api/signup')return route.fulfill({json:{ok:true,id:41,press:'dispatched',workspace_url:'/edition?id=41&sig=fixture'}});
      if(path==='/api/edition-email'){emailAccepted=true;return route.fulfill({json:{ok:true,delivery:{accepted:true}}});}
      if(path==='/api/edition-restore'){
        assert.equal(r.postDataJSON().post_id,'102');assert.equal(r.postDataJSON().sig,'restore-fixture');
        if(restoreFailure)return route.fulfill({status:503,json:{ok:false,error:'We could not save that change. Please try again.'}});
        await new Promise(resolve=>setTimeout(resolve,500));restored=true;
        return route.fulfill({json:{ok:true,selection:{revision:1,restored:['102']}}});
      }
      const shown=structuredClone(events);
      if(applied){
        for(const e of shown){e.selection_revision=1;if(e.kind==='reading')for(const d of e.decisions)if(d.post_id==='102')Object.assign(d,{original_decision:d.decision,original_reason:d.reason,decision:'keep',reason:'Kept by you.',author_override:true});}
        const c=shown.find(e=>e.kind==='contents');c.sections[0].posts.push({id:'102',title:'Thank you for 1,000 subscribers'});
      }
      if(path==='/api/edition')return route.fulfill({json:{ok:true,id:41,publication_url:'https://writer.substack.com',email:'owner@example.com',design:{cover:'classic'},status:ready?'proofed':'building',run_id:applied?'fixture.1.s1':'fixture.1',selection:{revision:restored?1:0,restored:restored?['102']:[]},restore_sig:ready?null:'restore-fixture',email_status:ready?(emailAccepted?'accepted':'queued'):null,retry_email_sig:ready?'fixture':null,change_url:ready?'/change?id=41&sig=fixture':null,events:[...shown,...(ready?[{sequence:5,kind:'layout',message:'The layout has been measured and fitted.',pages:42},{sequence:6,kind:'ready',pages:42,expires_at:'2030-01-01T00:00:00.000Z',files:[{label:'The edition',pages:42,url:'https://caithrin--inksheaf-proof-store-web.modal.run/proof?key=fixture.pdf&exp=1900000000&sig=fixture'}]}]:[])]}});
      if(path==='/api/verify'||path==='/api/verify-about')throw Error('The free PDF path must not send verification');
      return route.fulfill({json:{ok:false,message:'Local fixture'}});
    });
    await page.goto(base);
    await page.getByRole('textbox',{name:'Your publication URL',exact:true}).fill('caithrin.com');
    await page.getByRole('button',{name:'Preview my book'}).click();
    await page.locator('.design-choice[data-cover=classic]').click();
    await page.getByRole('button',{name:'Make this book',exact:true}).click();
    await page.getByRole('textbox',{name:'Your email for the complete PDF'}).fill('owner@example.com');
    await page.getByRole('button',{name:'Make my book',exact:true}).click();
    await page.waitForURL('**/edition?**');
    await page.locator('.reading-piece').first().waitFor();
    assert.equal(await page.locator('.reading-piece').count(),8);
    assert.equal(await page.locator('.aside-summary').count(),2);
    assert.match(await page.locator('#edition-cover').textContent(),/Don't worry about the vase/);
    await page.locator('.reading-piece').nth(2).locator('summary').click();
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:`${out}/${engine}-${width}-reading.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Contents',exact:true}).click();
    assert.equal(await page.locator('.contents-volume li').count(),6);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:`${out}/${engine}-${width}-contents.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'The reading',exact:true}).click();
    const choice=page.locator('.aside-summary[data-post-id="102"]');
    await choice.getByRole('button',{name:'Put this back in the book'}).focus();await page.keyboard.press('Enter');
    await choice.getByRole('status').filter({hasText:'could not save'}).waitFor();
    assert.equal(await choice.getByRole('button').isEnabled(),true);
    assert.match(await page.locator('#reading-intro').innerText(),/6 for the book, 2 set aside/);
    restoreFailure=false;
    await choice.getByRole('button').dblclick();
    await choice.getByRole('status').filter({hasText:'Saved.'}).waitFor();
    assert.equal(requests.filter(p=>p==='/api/edition-restore').length,2);
    assert.match(await page.locator('#reading-intro').innerText(),/7 for the book, 1 set aside/);
    assert.equal(await page.getByRole('button',{name:'Contents',exact:true}).isDisabled(),true);
    await page.reload();await page.locator('.reading-piece').first().waitFor();
    assert.match(await page.locator('#reading-intro').innerText(),/7 for the book, 1 set aside/);
    assert.equal(await page.locator('.aside-summary[data-post-id="102"] .restore-piece').isVisible(),false);
    await page.locator('.reading-piece').nth(2).locator('summary').click();
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:`${out}/${engine}-${width}-restored-pending.png`,fullPage:true,animations:'disabled'});
    applied=true;
    await page.waitForFunction(()=>document.querySelectorAll('.contents-volume li').length===7);
    assert.equal(await page.locator('.reading-piece').count(),8);
    assert.match(await page.locator('.reading-piece[data-post-id="102"] .piece-reason').textContent(),/Originally set aside.*subscriber milestones/);
    assert.match(await page.locator('.reading-piece[data-post-id="102"] blockquote').textContent(),/one thousand subscribers/);
    assert.equal(await page.locator('.reading-piece').nth(2).getAttribute('open'),'');
    await page.getByRole('button',{name:'Contents',exact:true}).click();
    assert.match(await page.locator('#contents-list').innerText(),/Thank you for 1,000 subscribers/);
    await page.getByRole('button',{name:'The reading',exact:true}).click();
    ready=true;
    await page.locator('.pdf-link').waitFor({timeout:10000});
    assert.match(await page.locator('#email-companion').innerText(),/email.*delayed/i);
    assert.equal(await page.locator('.reading-piece').nth(2).getAttribute('open'),'');
    assert.equal(await page.locator('.pdf-link').getAttribute('rel'),'noopener noreferrer');
    assert.match(await page.locator('.pdf-link').getAttribute('href'),/proof\?key=fixture/);
    await page.addScriptTag({content:axe});
    const violations=await page.evaluate(async()=>(await window.axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>v.id));
    assert.deepEqual(violations,[]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.locator('#print-options-link').getAttribute('href'),'#edition-next');
    assert.match(await page.locator('#download-expiry').innerText(),/2029|2030/);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:`${out}/${engine}-${width}-ready.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Retry PDF email'}).click();await page.waitForFunction(()=>document.getElementById('email-retry-status').textContent.includes('accepted'));
    assert.equal(requests.filter(p=>p==='/api/edition-email').length,1);
    await page.reload();await page.locator('.pdf-link').waitFor();
    assert.equal(requests.filter(p=>p==='/api/signup').length,1);
    assert.equal(requests.filter(p=>p.includes('verify')).length,0);
    assert.deepEqual(errors,[]);
    // Previously issued ownership links remain usable and scanner-safe.
    await page.setContent(await confirmationPage({publication_url:'https://caithrin.com',email:'owner@example.com'},'fixture').text());
    assert.deepEqual(await page.locator('dd').allTextContents(),['caithrin.com','owner@example.com']);
    results.push({engine,width,pass:true,states:['reading','contents','restore failure and retry','saved restore survives reload','corrected contents','PDF ready with email delayed','reload'],fixture:'synthetic source and recorded model events; 42 pages is a UI fixture, not a rendered PDF claim'});
    console.log('PASS publisher browser',engine,width);await page.close();
  }}finally{await browser.close();}
}
await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');
