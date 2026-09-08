import {chromium,webkit} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const out='output/style-guide-logo-background';
await mkdir(out,{recursive:true});
const assert=(v,m)=>{if(!v)throw Error(m)};
const rows=[];
const axe=await readFile('node_modules/axe-core/axe.min.js','utf8');
for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch();
  try{for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'});
    const errors=[],blocked=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
      const r=route.request();
      if(r.method()==='GET'&&new URL(r.url()).origin==='http://127.0.0.1:8830')return route.continue();
      blocked.push(r.method()+' '+r.url());return route.abort();
    });
    await page.goto('http://127.0.0.1:8830/');
    await page.evaluate(()=>document.fonts.ready);
    for(const mode of ['transparent','band','original']){
      await page.selectOption('#logo-treatment',mode);
      await page.waitForFunction(()=>[...document.querySelectorAll('#covers img, #object-book img')].every(i=>i.hidden||(i.complete&&i.naturalWidth>0)));
      const covers=await page.locator('#cover-gallery .cover-face').evaluateAll(els=>els.map(el=>{
        const b=el.getBoundingClientRect(),logo=el.querySelector('.cv-logo');
        const field=el.querySelector('.cv-mast').getBoundingClientRect();
        return {design:el.dataset.design,src:logo.getAttribute('src'),band:!!el.querySelector('.cv-logo-band'),
          ratio:b.width/b.height,fieldLeft:field.left-b.left,fieldRight:field.right-b.right,
          bad:[...el.querySelectorAll('.edition-cover>*,.cv-logo-band>*')]
            .filter(c=>getComputedStyle(c).display!=='none'&&c.getBoundingClientRect().width>0)
            .filter(c=>{const r=c.getBoundingClientRect();return r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1}).map(c=>c.className)};
      }));
      for(const c of covers){
        const variant=['classic','field'].includes(c.design)?'charcoal':'gold';
        assert(c.src===(mode==='transparent'?`assets/caithrin-mark-${variant}.svg`:'assets/example-caithrin-logo.png'),'wrong master '+JSON.stringify(c));
        assert(c.band===(mode==='band'),'band state '+JSON.stringify(c));
        assert(Math.abs(c.ratio-2/3)<.004&&!c.bad.length,'cover fit '+JSON.stringify({mode,...c}));
        if(c.design==='field')assert(Math.abs(c.fieldLeft)<1&&Math.abs(c.fieldRight)<1,'Field colour block is not full width');
      }
      if(mode==='band'){
        const backgrounds=await page.locator('#cover-gallery [data-design=field]').evaluate(el=>['.cv-mast','.cv-dates','.cv-logo-band'].map(s=>getComputedStyle(el.querySelector(s)).backgroundColor));
        assert(backgrounds.every(c=>c==='rgb(29, 30, 29)'),'Field fallback must be one continuous lower ground');
        assert(await page.locator('#cover-gallery [data-design=masthead] .cv-logo-band').evaluate(el=>getComputedStyle(el,'::before').borderTopStyle)==='solid','Masthead footer rule missing');
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');
      if(engineName==='chromium'){
        await page.locator('#covers').screenshot({path:`${out}/${mode}-${width}.png`});
        await page.locator('#cover-gallery').screenshot({path:`${out}/${mode}-covers-${width}.png`});
        if(mode==='transparent'){
          await page.locator('#logo-backgrounds').screenshot({path:`${out}/policy-${width}.png`});
          await page.locator('#object').screenshot({path:`${out}/object-${width}.png`});
        }
      }
      rows.push({engine:engineName,width,mode,covers});
    }
    await page.selectOption('#logo-treatment','band');
    await page.locator('#hide-logo').check();
    assert(await page.locator('#cover-gallery .cv-logo-band').count()===0,'missing logo leaves a band');
    assert(await page.locator('#cover-gallery .cv-logo:visible').count()===0,'missing logo visible');
    await page.locator('#hide-logo').uncheck();
    await page.selectOption('#publication-case','fox');
    assert(await page.locator('#cover-gallery .cv-logo-band').count()===0,'other publication inherits band');
    assert(await page.locator('#cover-gallery .cv-logo:visible').count()===0,'other publication inherits owner logo');
    await page.selectOption('#publication-case','caithrin');
    await page.addScriptTag({content:axe});
    const violations=await page.evaluate(async()=>(await axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
    assert(!violations.length,JSON.stringify(violations));
    assert(!blocked.length,'unexpected request '+blocked.join(';'));
    assert(!errors.length,errors.join(';'));
    console.log('PASS',engineName,width,'three logo modes, full-width Field block, missing/unrelated logos, axe');
    await page.close();
  }}finally{await browser.close()}
}
await writeFile(`${out}/checks.json`,JSON.stringify({pass:true,rows},null,2));
