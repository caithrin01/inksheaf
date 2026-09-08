import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { calendar } from './fixtures/preview-editor-exclusion.mjs';
import { confirmationPage } from '../functions/lib/verification.js';

const base = process.argv[2];
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local fixture browser test only');
const out = 'output/playwright/launch/verification';
await mkdir(out, { recursive: true });
const results = [];
const axe = await readFile('node_modules/axe-core/axe.min.js', 'utf8');
for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await browserType.launch();
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [], reservations = [], resends = [];
      page.on('pageerror', error => errors.push(error.message));
      let sent = false;
      await page.route('**/api/**', async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        if (path === '/api/preview') return route.fulfill({ json: calendar });
        if (path === '/api/signup') {
          reservations.push(req.postDataJSON());
          return route.fulfill({ json: { ok: true, id: 41, press: 'verify', sent, sent_to: 'writer@substack.com', ...(sent ? {} : { error: 'We could not send your confirmation.' }) } });
        }
        if (path === '/api/verify') {
          resends.push(req.postDataJSON()); sent = true;
          return route.fulfill({ json: { ok: true, sent: true, sent_to: 'writer@substack.com', verification_status: 'accepted' } });
        }
        if (path === '/api/verify-about') return route.fulfill({ json: { ok: true, code: 'inksheaf-verify-test' } });
        return route.fulfill({ json: { ok: false, message: 'Local fixture' } });
      });
      async function submit() {
        await page.goto(base);
        await page.getByRole('textbox', { name: 'Your publication URL' }).fill('caithrin.com');
        await page.getByRole('button', { name: 'Preview my book' }).click();
        await page.getByRole('button', { name: 'Reserve this print run', exact: true }).click();
        await page.getByRole('textbox', { name: 'Your email for the proof' }).fill('owner@example.com');
        await page.getByRole('button', { name: 'Request a spot', exact: true }).click();
        await page.locator('#done').waitFor({ state: 'visible' });
      }
      await submit();
      assert.match(await page.locator('#done-verify').innerText(), /could not send/);
      assert(!/We sent/.test(await page.locator('#done-verify').innerText()));
      await page.getByRole('button', { name: 'Prove it another way' }).waitFor({ state: 'visible' });
      assert.match(reservations[0].reservation_key, /^[0-9a-f-]{36}$/);
      await page.getByRole('button', { name: 'Send confirmation', exact: true }).click();
      await page.getByRole('button', { name: 'Resend confirmation', exact: true }).waitFor({ state: 'visible' });
      assert.match(await page.locator('#done-verify').innerText(), /We sent a confirmation link to writer@substack.com/);
      assert.deepEqual(resends, [{ signup_id: 41 }]);
      await page.screenshot({ path: `${out}/${engine}-${width}-resend.png`, fullPage: true });
      await submit();
      assert.equal(reservations[0].reservation_key, reservations[1].reservation_key, 'reload retry retains its request key');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.setContent(await confirmationPage({ publication_url:'https://caithrin.com', email:'owner@example.com' }, 'fixture').text());
      assert.equal(await page.getByRole('heading', { level:1 }).innerText(), 'Confirm your PDF request.');
      assert.deepEqual(await page.locator('dd').allTextContents(), ['caithrin.com', 'owner@example.com']);
      await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async () => (await window.axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => v.id));
      assert.deepEqual(violations, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `${out}/${engine}-${width}-confirmation.png`, fullPage: true });
      results.push({ engine, width, pass: true, cases: ['failed send with address', 'immediate fallback', 'resend', 'reload retry key', 'overflow', 'page errors'] });
      console.log('PASS verification browser', engine, width);
      await page.close();
    }
  } finally { await browser.close(); }
}
await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2) + '\n');
