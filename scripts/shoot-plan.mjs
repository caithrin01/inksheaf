import { chromium } from "playwright";
const S = process.argv[2];
const b = await chromium.launch(); 
for (const [host, w] of [["heathercoxrichardson.substack.com", 1200], ["caithrin.com", 1200], ["heathercoxrichardson.substack.com", 390]]) {
  const page = await b.newPage({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 1.3 });
  await page.goto(`http://localhost:8789/?pub=${host}`);
  await page.waitForFunction(() => document.getElementById("preview").classList.contains("personalized") || document.getElementById("tryerr").textContent.length > 3, null, { timeout: 120000 });
  await page.waitForTimeout(1800);
  const err = await page.evaluate(() => document.getElementById("tryerr").textContent);
  if (err) console.log(host, "ERR", err);
  await page.evaluate(() => document.getElementById("desk").scrollIntoView({ block: "start" }));
  await page.waitForTimeout(400);
  const el = await page.$("#desk");
  await el.screenshot({ path: `${S}/plan-${host.split(".")[0]}-${w}.png` });
  console.log(host, w, await page.evaluate(() => ({ what: document.getElementById("pv-reason").textContent, big: document.getElementById("pv-big").textContent, tabs: [...document.querySelectorAll(".desk-tab")].map(t => t.textContent + (t.disabled ? " (off)" : "")), verdict: document.getElementById("desk-verdict").textContent, price: document.getElementById("pv-price").textContent, by: document.getElementById("plan-by").textContent })));
  await page.close();
}
await b.close();
