#!/usr/bin/env node
// Local, simulated browser acceptance for the delayed editor and selected edition.
// Never sends a live reservation, event, verification, or model request.
import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { calendar, editorial } from './fixtures/preview-editor-exclusion.mjs';

const base = process.argv[2] || 'http://127.0.0.1:8806/';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local build required');
const out = process.argv[3] || 'output/playwright/edition';
const engine = process.argv[4] === 'webkit' ? webkit : chromium;
mkdirSync(out, {recursive:true});
const browser = await engine.launch();
const failures = [], evidence = [];
const axeSource = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const check = (condition, message) => { if (!condition) failures.push(message); };

for (const width of [1280,390]) for (const scheme of ['light','dark']) {
  const label = `${scheme}-${width}`;
  const context = await browser.newContext({viewport:{width,height:width===390?844:800},colorScheme:scheme,hasTouch:width===390,reducedMotion:'reduce'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  let releaseEditor;
  const editorReady = new Promise(resolve => {releaseEditor=resolve;});
  let submits = 0, payload, failSubmission = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/preview') return route.fulfill({json:route.request().url().includes('broken') ? {ok:false,message:'The archive could not be read.'} : calendar});
    if (path === '/api/plan') { await editorReady; return route.fulfill({json:{ok:true,editorial}}); }
    if (path === '/api/signup') {
      submits++; payload=route.request().postDataJSON();
      if (failSubmission) return route.abort('failed');
      await new Promise(resolve=>setTimeout(resolve,600));
      return route.fulfill({json:{ok:true,press:'test'}});
    }
    return route.fulfill({json:{ok:true}});
  });
  try {
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.locator('#tryurl').fill('caithrin.com');
    await page.locator('#trybtn').click();
    await page.waitForFunction(()=>document.querySelector('#preview').classList.contains('personalized'));
    check((await page.locator('#pv-status').textContent()).includes('164'),`${label}: calendar edition not announced`);
    await page.locator('#pv-cta').click();
    await page.getByRole('tab',{name:'Half-year set',exact:true}).click();
    await page.getByRole('button',{name:/^Colour,/}).click();
    releaseEditor();
    await page.waitForFunction(()=>document.querySelector('#plan-by').textContent.includes('Planned by our editor from'));
    check((await page.locator('#carried').textContent()).includes('22 pieces'),`${label}: open reservation kept the pre-editor count`);
    check(JSON.parse(await page.locator('#plan_json').inputValue()).volumes.reduce((a,v)=>a+v.posts,0)===22,`${label}: open reservation kept the pre-editor plan`);
    check((await page.locator('#desk-tabs [aria-selected="true"]').textContent()).includes('Half-year'),`${label}: editor reset chosen cadence`);
    check((await page.locator('#interior-row [aria-pressed="true"]').textContent()).includes('Colour'),`${label}: editor reset chosen interior`);
    for (const r of editorial.plan.routes) {
      const names={single:'One volume',half:'Half-year set',quarterly:'Quarterly'};
      await page.getByRole('tab',{name:names[r.cadence],exact:true}).click();
      const seen=await page.evaluate(()=>Object.fromEntries(['pv-status','pv-sub','pv-cvpages','pv-dates','pv-big','plan-what','route-why','desk-verdict'].map(id=>[id,document.getElementById(id).textContent])));
      const posts=r.volumes.reduce((a,v)=>a+v.posts,0), pages=r.volumes.reduce((a,v)=>a+v.est_pages,0);
      check(seen['pv-status'].includes(String(posts)),`${label}/${r.cadence}: status omits ${posts} essays: ${seen['pv-status']}`);
      check(seen['pv-status'].includes(String(pages)),`${label}/${r.cadence}: status omits ${pages} pages: ${seen['pv-status']}`);
      check(seen['pv-status'].includes(editorial.window.span),`${label}/${r.cadence}: status omits span`);
      check(seen['pv-status'].includes(`${r.volumes.length} volume`),`${label}/${r.cadence}: status omits selected volume count`);
      check(seen['pv-sub'].includes(String(posts)),`${label}/${r.cadence}: description omits selected essay count`);
      check(!/\b23\b|36,037/.test(seen['pv-sub']),`${label}/${r.cadence}: description leaks archive totals: ${seen['pv-sub']}`);
      check(seen['pv-sub'].includes(String(pages)),`${label}/${r.cadence}: description omits selected pages`);
      check(!/roughly balanced/i.test(seen['route-why']),`${label}/${r.cadence}: unequal books described as balanced`);
      check(!/\.\./.test(seen['desk-verdict']),`${label}/${r.cadence}: doubled punctuation`);
      check(seen['pv-dates']===editorial.window.span,`${label}/${r.cadence}: cover span drift`);
      check(await page.locator('#foliobar .folio-seg').count()===r.volumes.length,`${label}/${r.cadence}: wrong displayed volumes`);
      evidence.push({label,cadence:r.cadence,seen});
    }
    await page.locator('#desk-tabs [aria-selected="true"]').focus();
    await page.keyboard.press('Home');
    check((await page.locator('#desk-tabs [aria-selected="true"]').textContent()).includes('One volume'),`${label}: Home key does not select first cadence`);
    await page.keyboard.press('End');
    check((await page.locator('#desk-tabs [aria-selected="true"]').textContent()).includes('Quarterly'),`${label}: End key does not select last cadence`);
    check(await page.evaluate(()=>document.activeElement?.getAttribute('aria-selected')==='true'),`${label}: cadence rebuild lost keyboard focus`);
    await page.mouse.move(0,0);
    await page.locator('#preview').evaluate(el=>el.scrollIntoView({block:'start'}));
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({path:`${out}/edition-${label}.png`});
    await page.locator('#bookwrap').focus();
    await page.keyboard.press('Enter');
    await page.screenshot({path:`${out}/contents-${label}.png`});
    check(await page.locator('#bookwrap').getAttribute('aria-pressed')==='true',`${label}: keyboard cannot open contents`);
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: horizontal overflow`);
    await page.addScriptTag({content:axeSource});
    const axe=await page.evaluate(()=>window.axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
    for (const violation of axe.violations) failures.push(`${label}: axe ${violation.id}: ${violation.nodes.map(n=>n.target.join(' ')).join(', ')}`);
    await page.locator('#pv-cta').click();
    const carried=await page.locator('#carried').textContent();
    check(carried.includes('22')&&carried.includes('179'),`${label}: reservation has stale edition: ${carried}`);
    await page.locator('#email').fill('reader+journeytest@example.com');
    failSubmission=true;
    await page.locator('#f button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#err').textContent.includes('could not confirm'));
    check(await page.locator('#email').inputValue()==='reader+journeytest@example.com',`${label}: network failure lost the email`);
    check(await page.locator('#f button[type=submit]').isEnabled(),`${label}: retry button stuck disabled`);
    failSubmission=false;submits=0;
    await page.locator('#f button[type=submit]').dblclick();
    await page.waitForFunction(()=>document.querySelector('#done').style.display==='block');
    check(submits===1,`${label}: repeated click sent ${submits} reservations`);
    const sent=JSON.parse(payload.plan_json);
    check(sent.cadence==='quarterly'&&sent.volumes.length===3,`${label}: reservation payload differs from selected route`);
    await page.screenshot({path:`${out}/reserved-${label}.png`});
    await page.locator('#tryurl').fill('broken.substack.com');
    await page.locator('#trybtn').click();
    await page.waitForFunction(()=>!document.querySelector('#tryhandoff').hidden);
    check((await page.locator('#pv-mast').textContent())==='Your publication',`${label}: failed publication still shows the old cover`);
    check((await page.locator('#plan_json').inputValue())==='',`${label}: failed publication kept the previous reservation plan`);
    await page.locator('#tryhandoff').click();
    check(await page.locator('#email').isVisible(),`${label}: hand-built fallback cannot reopen after a reservation`);
    check((await page.locator('#url').inputValue()).includes('broken.substack.com'),`${label}: fallback carries the wrong publication`);
    check(errors.length===0,`${label}: browser errors: ${errors.join(' | ')}`);
  } catch (error) { failures.push(`${label}: ${error.message}`); releaseEditor(); }
  finally { await context.close(); }
}
await browser.close();
writeFileSync(`${out}/results.json`,JSON.stringify({simulated:true,evidence,failures},null,2));
console.log(failures.length?`EDITION JOURNEY: ${failures.length} failures\n${failures.join('\n')}`:`EDITION JOURNEY: delayed editor, every cadence, contents, reservation and axe clean in four configurations`);
process.exitCode=failures.length?1:0;
