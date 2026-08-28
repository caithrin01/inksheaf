#!/usr/bin/env node
// Teaser type layer: transparent caption overlays + the closing card, in Inksheaf tokens.
// Rendered like econ-card (playwright over localhost), 3840x2160.
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
mkdirSync("assets/type", { recursive: true });
const mark = readFileSync("public/brand/mark.svg", "utf-8");

const CAPTIONS = [
  ["cap-hook",   "Your Substack is already a book."],
  ["cap-money",  "Paste your URL. Watch it become one."],
  ["cap-spread", "Real footnotes. Running headers. Your prose."],
  ["cap-morph",  "It arrives wearing your publication’s own theme."],
  ["cap-turn",   "You approve every page before anything prints."],
];
const css = `
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,300..700&family=Inter:wght@600&display=swap');
body{margin:0;width:1920px;height:1080px;font-family:"Source Serif 4",Georgia,serif}
.cap{position:absolute;left:72px;bottom:64px;color:#f6f1e6;font-size:44px;font-weight:560;
  letter-spacing:-.01em;text-shadow:0 1px 2px rgba(0,0,0,.55), 0 8px 28px rgba(0,0,0,.35);
  background:rgba(23,20,16,.28);padding:14px 26px;border-left:3px solid #a63a2b;border-radius:2px}
.close{width:1920px;height:1080px;background:#171410;color:#e9e2d3;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:28px}
.close svg{height:200px;color:#e9e2d3}
.close .word{font-size:88px;font-weight:600;letter-spacing:-.01em}
.close .sub{font-family:Inter,sans-serif;font-size:22px;letter-spacing:.32em;text-transform:uppercase;color:#8a8272}
.close .url{font-size:30px;color:#d0604e;margin-top:10px}`;

for (const [name, text] of CAPTIONS)
  writeFileSync(`assets/type/${name}.html`,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="cap">${text}</div></body></html>`);
writeFileSync("assets/type/card-close.html",
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="close">${mark.replace('<svg ','<svg aria-hidden="true" ')}<div class="word">inksheaf</div><div class="sub">Your Substack, printed &amp; bound</div><div class="url">inksheaf.com &middot; private beta</div><div class="sub" style="margin-top:34px;font-size:16px">Music: 13ounce &mdash; OKAY</div></div></body></html>`);

const port = 9100 + Math.floor(Math.random() * 400);
const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: "assets/type", stdio: "ignore" });
await new Promise(r => setTimeout(r, 1000));
const shots = [...CAPTIONS.map(c => c[0]), "card-close"];
const code = `async page => {
  await page.setViewportSize({width: 3840, height: 2160});
  for (const n of ${JSON.stringify(shots)}) {
    await page.goto('http://127.0.0.1:${port}/' + n + '.html', {waitUntil:'networkidle'});
    try { await page.addStyleTag({content: 'html{zoom:2}'}); } catch {}
    await page.waitForTimeout(900);
    await page.screenshot({path: '${process.cwd()}/assets/type/' + n + '.png',
      omitBackground: n !== 'card-close'});
  }
  return 'done';
}`;
try { execFileSync("playwright-cli", ["open", "about:blank"], { stdio: "pipe" }); } catch {}
try {
  const out = execFileSync("playwright-cli", ["run-code", code], { stdio: ["ignore","pipe","pipe"] }).toString();
  console.log(out.includes('"done"') ? "type layer rendered" : "FAIL: " + out.slice(0, 200));
} finally { srv.kill(); }
