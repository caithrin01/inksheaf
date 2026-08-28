#!/usr/bin/env node
// Teaser asset A8: the measured-economics beat as a print card. Every number is read from
// the vault evidence JSON (lulu-costs.json); nothing is typed by hand.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
mkdirSync("assets/shots", { recursive: true });

const EV = "/Users/caithrinrintoul/Library/Mobile Documents/com~apple~CloudDocs/Caithrin/05-Projects/Substack Magazine/evidence/lulu-costs.json";
const data = JSON.parse(readFileSync(EV, "utf-8"));
const west = p => data.rows.find(r => r.pages === p && r.destination === "west");
const rows = [60, 132, 220, 300].map(p => west(p)).filter(Boolean);

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,300..700&family=Inter:wght@600&display=swap" rel="stylesheet">
<style>
body{margin:0;width:1920px;height:1080px;display:flex;align-items:center;justify-content:center;
  background:#efe8d8;font-family:"Source Serif 4",Georgia,serif;color:#221d16}
.card{background:#fbf7ee;border:1.5px solid #221d16;border-radius:3px;padding:64px 72px;
  box-shadow:0 2px 3px rgba(34,29,22,.14),24px 34px 60px -24px rgba(34,29,22,.45);width:1100px}
.k{font-family:Inter,sans-serif;font-size:20px;letter-spacing:.3em;text-transform:uppercase;color:#a63a2b;font-weight:600}
h1{font-size:56px;margin:.35em 0 .8em;font-weight:600;letter-spacing:-.01em}
table{width:100%;border-collapse:collapse;font-size:30px}
td,th{padding:18px 8px;border-bottom:1px solid rgba(34,29,22,.2);text-align:left}
th{font-family:Inter,sans-serif;font-size:18px;letter-spacing:.14em;text-transform:uppercase;color:rgba(34,29,22,.58);font-weight:600}
td.n{font-variant-numeric:tabular-nums}
.foot{margin-top:36px;font-size:24px;color:rgba(34,29,22,.58)}
b{color:#a63a2b}
</style></head><body><div class="card">
<div class="k">Measured, not estimated</div>
<h1>What a printed issue actually costs</h1>
<table><tr><th>Pages</th><th>Print</th><th>Shipping</th><th>Landed, mainland US</th></tr>
${rows.map(r => `<tr><td class="n">${r.pages}</td><td class="n">$${r.print_cost.toFixed(2)}</td><td class="n">$${r.shipping.toFixed(2)}</td><td class="n"><b>$${r.total.toFixed(2)}</b></td></tr>`).join("\n")}
</table>
<div class="foot">Production Lulu API, ${data.measured_at} · package ${data.package_id.slice(0, 9)}… · readers pay this, we add nothing</div>
</div></body></html>`;
writeFileSync("assets/shots/econ-card.html", html);

const { spawn } = await import("node:child_process");
const port = 9100 + Math.floor(Math.random() * 400);
const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: "assets/shots", stdio: "ignore" });
await new Promise(r => setTimeout(r, 1000));
const code = `async page => {
  await page.setViewportSize({width: 3840, height: 2160});
  await page.goto('http://127.0.0.1:${port}/econ-card.html', {waitUntil:'networkidle'});
  try { await page.addStyleTag({content: 'html{zoom:2}'}); } catch {}
  await page.waitForTimeout(1200);
  await page.screenshot({path: '${process.cwd()}/assets/shots/econ-card.png'});
  return 'ok';
}`;
try { execFileSync("playwright-cli", ["open", "about:blank"], { stdio: "pipe" }); } catch {}
try {
  const out = execFileSync("playwright-cli", ["run-code", code], { stdio: ["ignore","pipe","pipe"] }).toString();
  console.log(out.includes('"ok"') ? "econ-card.png written" : "FAILED: " + out.slice(0, 200));
} finally { srv.kill(); }
