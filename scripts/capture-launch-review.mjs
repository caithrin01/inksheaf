#!/usr/bin/env node
// Visual evidence for the entrance, scroll sequence, reveal and cover interaction.
import { chromium } from 'playwright';
import { mkdirSync, renameSync } from 'node:fs';
import { edited } from './fixtures/preview-editor-exclusion.mjs';
const base=process.argv[2]||'http://127.0.0.1:8806/';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local build required');
const out=process.argv[3]||'output/playwright/motion';mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
try{
  for(const [width,height]of [[1280,720],[390,844]]){
    const context=await browser.newContext({viewport:{width,height},hasTouch:width===390,recordVideo:{dir:out,size:{width,height}}});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/preview'?edited:{ok:true}}));
    await page.goto(base,{waitUntil:'domcontentloaded'});await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(800);await page.screenshot({path:`${out}/opening-${width}.png`});
    await page.waitForFunction(()=>document.querySelector('#hero-story').dataset.motionReady==='true');
    await page.mouse.wheel(0,120);
    await page.waitForFunction(()=>document.querySelector('#hero-story').dataset.phase==='opening');
    for(const [phase,delay]of [['early',120],['middle',200],['late',220]]){
      await page.waitForTimeout(delay);await page.screenshot({path:`${out}/hero-${phase}-${width}.png`});
    }
    await page.waitForFunction(()=>document.querySelector('#hero-story').dataset.phase==='ready');
    await page.waitForTimeout(600);
    await page.locator('#hero-try').click();
    await page.locator('#tryurl').fill('caithrin.com');await page.locator('#trybtn').click();
    await page.waitForFunction(()=>document.querySelector('#preview').classList.contains('personalized'),null,{timeout:25000});
    await page.mouse.move(0,0);await page.waitForTimeout(1000);
    await page.screenshot({path:`${out}/cover-${width}.png`});
    await page.locator('#bookwrap').focus();await page.keyboard.press('Enter');
    for(const [phase,delay]of [['early',150],['middle',200],['settled',500]]){
      await page.waitForTimeout(delay);await page.screenshot({path:`${out}/turn-${phase}-${width}.png`});
    }
    await page.keyboard.press('Enter');await page.waitForTimeout(800);
    const video=page.video();await context.close();renameSync(await video.path(),`${out}/journey-${width}.webm`);
    if(errors.length)throw new Error(errors.join(' | '));
    console.log(`Captured ${width}×${height} entrance, reveal and cover interaction.`);
  }
}finally{await browser.close();}
