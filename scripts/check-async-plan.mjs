import { chromium } from "playwright";
const base = process.argv[2] || "http://localhost:8789", host = process.argv[3] || "caithrin.com";
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1200, height: 1000 } });
const t0 = Date.now();
await page.goto(`${base}/?pub=${host}`);
await page.waitForFunction(() => document.getElementById("preview").classList.contains("personalized"), null, { timeout: 120000 });
const first = await page.evaluate(() => ({ by: document.getElementById("plan-by").textContent, big: document.getElementById("pv-big").textContent, labels: [...document.querySelectorAll(".folio-seg .fs-dates")].map(x => x.textContent) }));
console.log(`painted at ${Date.now() - t0} ms:`, JSON.stringify(first));
try {
  await page.waitForFunction(() => /editor from your archive/.test(document.getElementById("plan-by").textContent), null, { timeout: 170000 });
  const second = await page.evaluate(() => ({ by: document.getElementById("plan-by").textContent, big: document.getElementById("pv-big").textContent, what: document.getElementById("pv-reason").textContent, labels: [...document.querySelectorAll(".folio-seg .fs-dates")].map(x => x.textContent), status: document.getElementById("pv-status").textContent }));
  console.log(`editor landed at ${Date.now() - t0} ms:`, JSON.stringify(second));
} catch { console.log(`editor did not land within 170 s; plan-by: ${await page.evaluate(() => document.getElementById("plan-by").textContent)}`); }
await b.close();
