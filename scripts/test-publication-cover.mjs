#!/usr/bin/env node
// Local browser check for identity, logo reset, and the actual painted masthead (WebKit 3D regression).
import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { edited } from './fixtures/preview-editor-exclusion.mjs';
const base = process.argv[2] || 'http://127.0.0.1:8806/';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Local build required');
const out = process.argv[3] || 'output/playwright/publication-cover'; mkdirSync(out, { recursive: true });
const logoUrl = 'https://substackcdn.com/identity-test-logo.svg';
const data = { ...edited, publication: 'The Fox Says', host: 'manifund.substack.com', logo_url: logoUrl };
const rows = [];
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      const name = `${engine.name()}-${width}`;
      let fixture = structuredClone(data);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/preview' ? fixture : { ok: true } }));
      // Clearly synthetic, stable mark for geometry/loading checks; not the publication's real logo.
      await page.route(logoUrl, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" fill="#943d24"/><text x="26" y="30" text-anchor="middle" font-size="11" fill="white">TEST</text></svg>' }));
      await page.goto(`${base}?pub=manifund.substack.com`);
      await page.locator('#pv-logo').waitFor({ state: 'visible' });
      await page.locator('#bookwrap').scrollIntoViewIfNeeded(); await page.evaluate(() => document.fonts.ready);
      if (await page.locator('#pv-mast').textContent() !== 'The Fox Says') throw new Error(`${name}: wrong masthead`);
      const box = await page.locator('#pv-mast').boundingBox();
      const before = await page.screenshot();
      await page.locator('#pv-mast').evaluate(el => el.style.visibility = 'hidden');
      const hidden = await page.screenshot();
      await page.locator('#pv-mast').evaluate(el => el.style.removeProperty('visibility'));
      const changed = await page.evaluate(async ({ before, hidden, box }) => {
        async function pixels(encoded) {
          const img = new Image(); img.src = 'data:image/png;base64,' + encoded; await img.decode();
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
          return ctx.getImageData(Math.ceil(box.x), Math.ceil(box.y), Math.floor(box.width), Math.floor(box.height)).data;
        }
        const [a, b] = await Promise.all([pixels(before), pixels(hidden)]);
        let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]) > 30) n++;
        return n;
      }, { before: before.toString('base64'), hidden: hidden.toString('base64'), box });
      if (changed < 100) throw new Error(`${name}: masthead exists in DOM but is not painted (${changed} pixels)`);
      await page.screenshot({ path: `${out}/${name}.png` });
      fixture = { ...fixture, host: 'long-name.substack.com', publication: 'Letters about the changing shape of work, technology, and everything we build together across the years and generations' };
      await page.locator('#tryurl').fill(fixture.host); await page.locator('#trybtn').click();
      await page.waitForFunction(() => document.querySelector('#pv-mast').textContent.startsWith('Letters about'));
      const fits = await page.evaluate(() => {
        const mast=document.querySelector('#pv-mast').getBoundingClientRect(), dates=document.querySelector('#pv-dates').getBoundingClientRect(), foot=document.querySelector('#pv-cvpages').getBoundingClientRect(), front=document.querySelector('#pvbook .edition-cover').getBoundingClientRect();
        return mast.bottom<dates.top && dates.bottom<foot.top && foot.bottom<front.bottom;
      });
      if (!fits) throw new Error(`${name}: long publication name and logo overflow the cover`);
      fixture = { ...fixture, host: 'no-logo.substack.com', publication: 'A publication without a logo', logo_url: null };
      await page.locator('#tryurl').fill(fixture.host); await page.locator('#trybtn').click();
      await page.waitForFunction(() => document.querySelector('#pv-mast').textContent === 'A publication without a logo');
      if (!(await page.locator('#pv-logo').isHidden()) || await page.locator('#pv-logo').getAttribute('src')) throw new Error(`${name}: previous publication logo leaked`);
      fixture = { ...fixture, host: 'broken-logo.substack.com', logo_url: 'https://substackcdn.com/broken-logo.svg' };
      await page.route(fixture.logo_url, route => route.abort());
      await page.locator('#tryurl').fill(fixture.host); await page.locator('#trybtn').click();
      await page.waitForFunction(() => document.querySelector('#preview').classList.contains('personalized'));
      if (!(await page.locator('#pv-logo').isHidden())) throw new Error(`${name}: broken image visible`);
      if (errors.length) throw new Error(errors.join('; '));
      rows.push({ name, painted_masthead_pixels: changed, pass: true }); console.log(`PASS ${name}: name, painted masthead, logo loading/reset/failure`);
      await page.close();
    }
  } finally { await browser.close(); }
}
writeFileSync(`${out}/results.json`, JSON.stringify({ simulated: true, logo: 'synthetic fixture', rows }, null, 2));
