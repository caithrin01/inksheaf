#!/usr/bin/env node
// scroll-qa.mjs <url> [outdir] — built-page visual/integration gate for the image-led hero.
// It exercises cold paint, every dissolve, both CTA routes, error/success preview states, and the
// static reduced-motion treatment. Screenshots are evidence; assertions decide the verdict.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync } from "node:fs";

const url = process.argv[2] || "http://localhost:8798/";
const out = process.argv[3] || "/tmp/inksheaf-scroll-qa";
mkdirSync(out, { recursive: true });
const viewports = [[1440,812],[1280,720],[1175,649],[390,844]];
const fixture = {
  ok:true, host:"fixture.substack.com", publication:"Fixture Review", public_posts:12, posts:12,
  words:24000, from:"2025-09-01", to:"2026-08-31", est_pages:118, cadence:"Annual",
  form:"a collected edition", unit:"volume", noun:"essay", kind:"essays", image_rate:0,
  paid_posts:0, podcast_posts:0, capped:false, young:false,
  sample:[{t:"The Shape of Attention"},{t:"Notes from the Workshop"},{t:"The Durable Web"}],
};

/* a real production response (caithrin.com, 2026-09-04) carrying both the rolling read and the
   editor's plan: the page must show one edition everywhere (Codex, production journey) */
const realPath = new URL("./fixtures/preview-caithrin-2026-09-04.json", import.meta.url);
const real = existsSync(realPath) ? JSON.parse(readFileSync(realPath, "utf8")) : null;
const browser = await chromium.launch();
const problems = [];
function problem(message){problems.push(message);}

for (const scheme of ["light","dark"]) {
  for (const [width,height] of viewports) {
    const context = await browser.newContext({viewport:{width,height},deviceScaleFactor:1,colorScheme:scheme});
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(String(error)));
    await page.route("**/api/preview?*", async route => {
      const requestUrl = new URL(route.request().url());
      const requested = requestUrl.searchParams.get("url") || "";
      const body = requested.includes("broken")
        ? {ok:false,message:"We could not read that archive. Try again or ask for a hand-built preview."}
        : (requested.includes("caithrin") && real) ? real : fixture;
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
    });
    await page.route("**/api/plan?*", route => route.fulfill({status:404,body:"not found"}));
    await page.goto(url+`?qa=${Date.now()}`,{waitUntil:"domcontentloaded"});
    await page.waitForTimeout(120);

    const cold = await page.evaluate(() => {
      const stage=document.querySelector('.sheaf-stage,.stage');
      const image=document.querySelector('.sheaf-frame,#f0');
      const style=stage&&getComputedStyle(stage);
      return {background:style?.backgroundImage||"",firstOpacity:image?getComputedStyle(image).opacity:"0"};
    });
    if (!cold.background || cold.background === "none") problem(`${scheme}/${width}: cold stage has no painted fallback`);
    if (+cold.firstOpacity < .99) problem(`${scheme}/${width}: first frame is not opaque before script settles`);
    if (width===1280 || width===390) await page.screenshot({path:`${out}/cold-${scheme}-${width}.png`});

    await page.waitForTimeout(800);
    const travel = await page.evaluate(() => {
      const story=document.querySelector('#hero-story,#scroll');
      return story.offsetHeight-window.innerHeight;
    });
    for (let step=0;step<=20;step++) {
      const fraction=step/20;
      await page.evaluate(y => window.scrollTo(0,y),Math.round(travel*fraction));
      await page.waitForTimeout(70);
      const state = await page.evaluate(() => {
        const frames=[...document.querySelectorAll('.sheaf-frame,.stage > picture > .frame')];
        const visible=frames.map(frame => ({opacity:+getComputedStyle(frame).opacity,loaded:frame.complete&&frame.naturalWidth>0}));
        return {max:Math.max(0,...visible.filter(item=>item.loaded).map(item=>item.opacity))};
      });
      if (state.max < .5) problem(`${scheme}/${width} p${fraction.toFixed(2)}: no loaded frame above 0.5 opacity`);
      if (width===1440 && [0,5,6,10,14,18,20].includes(step))
        await page.screenshot({path:`${out}/p${Math.round(fraction*100)}-${scheme}-${width}.png`});
    }

    const titleFit = await page.evaluate(() => {
      const title=document.getElementById('tryit').getBoundingClientRect();
      const button=document.getElementById('trybtn').getBoundingClientRect();
      return {titleTop:title.top,titleBottom:title.bottom,buttonRight:button.right,buttonBottom:button.bottom,w:innerWidth,h:innerHeight};
    });
    if (titleFit.titleTop < 0 || titleFit.titleBottom > titleFit.h || titleFit.buttonRight > titleFit.w || titleFit.buttonBottom > titleFit.h)
      problem(`${scheme}/${width}: title controls clip outside the viewport`);
    if (width===1280 || width===390) await page.screenshot({path:`${out}/title-${scheme}-${width}.png`});

    if (width===1280) {
      await page.evaluate(() => window.scrollTo(0,0));
      await page.click('#hero-try');
      await page.waitForTimeout(800);
      if (await page.evaluate(() => document.activeElement?.id !== 'tryurl')) problem(`${scheme}: header CTA did not focus the title field`);

      await page.fill('#tryurl','broken.substack.com');
      await page.click('#trybtn');
      await page.waitForFunction(() => document.getElementById('tryhandoff')?.hidden === false);
      await page.screenshot({path:`${out}/error-${scheme}-1280.png`});

      await page.fill('#tryurl','fixture.substack.com');
      await page.click('#trybtn');
      await page.waitForFunction(() => document.getElementById('preview')?.classList.contains('personalized'),null,{timeout:15000});
      await page.waitForTimeout(400);
      await page.screenshot({path:`${out}/success-${scheme}-1280.png`});

      if (real) {
        /* the real payload: one edition on the cover, in the announcement, in the description and on the desk */
        await page.fill('#tryurl','caithrin.com');
        await page.click('#trybtn');
        await page.waitForFunction(pub => document.getElementById('pv-mast')?.textContent === pub, real.publication, {timeout:15000});
        await page.waitForTimeout(600);
        const ed = real.editorial, golden = ed.plan.routes.find(r => r.recommended) || ed.plan.routes[0];
        const goldenPages = golden.volumes.reduce((a, v) => a + v.est_pages, 0);
        const seen = await page.evaluate(() => ({ dates: document.getElementById('pv-dates').textContent, cv: document.getElementById('pv-cvpages').textContent,
          status: document.getElementById('pv-status').textContent, sub: document.getElementById('pv-sub').textContent, kind: document.getElementById('pv-kind').textContent }));
        if (seen.dates !== ed.window.span) problem(`${scheme}: cover dates "${seen.dates}" are not the planned window "${ed.window.span}"`);
        if (!seen.cv.includes(String(goldenPages))) problem(`${scheme}: cover pages line "${seen.cv}" does not carry the planned ${goldenPages} pages`);
        if (!seen.status.includes(String(goldenPages)) || !seen.status.includes(ed.window.span)) problem(`${scheme}: announcement "${seen.status}" does not name the planned edition`);
        if (seen.sub.split(ed.window.span).length - 1 > 1) problem(`${scheme}: description repeats the window: "${seen.sub}"`);
        if (seen.cv.includes(String(real.est_pages)) && real.est_pages !== goldenPages) problem(`${scheme}: cover carries the rolling ${real.est_pages} pages beside the plan`);
        /* every enabled cadence tab: the sentence counts the volumes actually shown */
        const WORDS = ["no","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"];
        const tabs = await page.locator('.desk-tab:not([disabled])').count();
        for (let t = 0; t < tabs; t++) {
          await page.locator('.desk-tab:not([disabled])').nth(t).click(); await page.waitForTimeout(150);
          const row = await page.evaluate(() => ({ why: document.getElementById('route-why').textContent, segs: document.querySelectorAll('#foliobar .folio-seg').length, dates: document.getElementById('pv-dates').textContent }));
          const each = row.why.match(/(\w+) (half-years|quarters|months), one book each/), mm = row.why.match(/(\w+) books from/);
          if (/A book a month/.test(row.why) && row.segs !== 12) problem(`${scheme}: "${row.why}" over ${row.segs} volumes`);
          if (each && WORDS[row.segs] !== each[1].toLowerCase()) problem(`${scheme}: "${row.why}" over ${row.segs} volumes`);
          if (mm && WORDS[row.segs] !== mm[1].toLowerCase()) problem(`${scheme}: "${row.why}" over ${row.segs} volumes`);
          if (row.dates !== ed.window.span) problem(`${scheme}: cover dates changed to "${row.dates}" on a cadence switch`);
        }
        await page.screenshot({path:`${out}/real-${scheme}-1280.png`});
      }
      await page.locator('[data-hero-try]').last().scrollIntoViewIfNeeded();
      await page.locator('[data-hero-try]').last().click();
      await page.waitForTimeout(800);
      if (await page.evaluate(() => document.activeElement?.id !== 'tryurl')) problem(`${scheme}: lower CTA did not focus the title field`);
    }
    if (pageErrors.length) problem(`${scheme}/${width}: page errors: ${pageErrors.join(' | ')}`);
    await context.close();
  }
}

for (const [width,height] of [[1280,720],[390,844]]) {
  const context = await browser.newContext({viewport:{width,height},reducedMotion:"reduce",colorScheme:"dark"});
  const page = await context.newPage();
  await page.goto(url+`?reduced=${Date.now()}`,{waitUntil:"networkidle"});
  const state = await page.evaluate(() => {
    const story=document.getElementById('hero-story');
    const finalFrame=getComputedStyle(document.getElementById('hero-f3'));
    const title=getComputedStyle(document.getElementById('tryit'));
    const rect=document.getElementById('trybtn').getBoundingClientRect();
    return {height:story.offsetHeight,viewport:innerHeight,frameDisplay:finalFrame.display,frameOpacity:+finalFrame.opacity,
      titleOpacity:+title.opacity,titlePointer:title.pointerEvents,buttonBottom:rect.bottom};
  });
  if (Math.abs(state.height-state.viewport)>2) problem(`reduced/${width}: hero is not a single static viewport`);
  if (state.frameDisplay==='none'||state.frameOpacity<.99) problem(`reduced/${width}: settled title frame is not visible`);
  if (state.titleOpacity<.99||state.titlePointer==='none'||state.buttonBottom>height) problem(`reduced/${width}: title controls are not usable`);
  await page.screenshot({path:`${out}/reduced-${width}.png`});
  await context.close();
}

await browser.close();
console.log(problems.length ? `SCROLL-QA: ${problems.length} PROBLEM(S)\n${problems.join("\n")}`
  : `SCROLL-QA: clean — scroll, CTAs, error, success and reduced motion verified; screenshots in ${out}`);
process.exit(problems.length?1:0);
