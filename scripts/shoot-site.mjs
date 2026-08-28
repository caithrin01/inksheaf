#!/usr/bin/env node
// Teaser assets A1-A3, A7: the live site, both color schemes, 16:9 4K masters + two 9:16 verticals.
// Drives the production site (warm preview cache for caithrin) via playwright-cli.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
mkdirSync("assets/shots", { recursive: true });
const CWD = process.cwd();

const code = `async page => {
  const shots = [];
  // 2x mastering: double-size viewport + zoom 2 => logical layout at half, rendered at full
  const setSize = async (w, h) => page.setViewportSize({ width: w * 2, height: h * 2 });
  const zoom = async () => { try { await page.addStyleTag({ content: 'html{zoom:2}' }); } catch {} };
  const shot = async (name, opts = {}) => {
    await page.screenshot({ path: '${CWD}/assets/shots/' + name + '.png', ...opts });
    shots.push(name);
  };
  await setSize(1920, 1080);

  // A1 hero, light then dark
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('https://inksheaf.pages.dev/', { waitUntil: 'networkidle' });
  await zoom();
  await page.waitForTimeout(1200);
  await shot('site-hero-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(600);
  await shot('site-hero-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // A2 the moment: empty -> typed -> typesetting -> result
  await page.locator('#tryit').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot('preview-1-empty');
  await page.click('#tryurl');
  await page.type('#tryurl', 'https://www.caithrin.com', { delay: 40 });
  await shot('preview-2-typed');
  await page.click('#trybtn');
  await shot('preview-3-typesetting');
  await page.waitForSelector('.preview.on', { timeout: 30000 });
  await page.waitForTimeout(2600);
  await page.locator('#preview').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shot('preview-4-result');

  // A7 element shots: the assembled branded book + contents page + static spread
  await page.locator('#pvbook').screenshot({ path: '${CWD}/assets/shots/obj-book-branded.png' });
  await page.locator('#pv-page').screenshot({ path: '${CWD}/assets/shots/obj-contents-page.png' });
  await page.locator('.bookstage').screenshot({ path: '${CWD}/assets/shots/obj-bookstage.png' });
  shots.push('obj-book-branded', 'obj-contents-page', 'obj-bookstage');

  // A3 funnel: step 1 prefilled, step 2
  await page.click('#pv-cta');
  await page.waitForTimeout(800);
  await page.locator('#beta').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot('funnel-step2');

  // 9:16 verticals: hero + preview result
  await setSize(607, 1080);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('https://inksheaf.pages.dev/?pub=www.caithrin.com', { waitUntil: 'domcontentloaded' });
  await zoom();
  await page.waitForTimeout(1000);
  await shot('site-hero-vert');
  await page.waitForSelector('.preview.on', { timeout: 30000 });
  await page.waitForTimeout(2800);
  await page.locator('#preview').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot('preview-result-vert');
  return shots.join(',');
}`;

execFileSync("playwright-cli", ["open", "about:blank"], { stdio: "pipe" });
const out = execFileSync("playwright-cli", ["run-code", code], { stdio: ["ignore", "pipe", "pipe"] }).toString();
const m = out.match(/### Result\n"([^"]+)"/);
console.log("shots:", m ? m[1].split(",").length : "PARSE FAIL", m ? m[1] : out.slice(0, 300));
